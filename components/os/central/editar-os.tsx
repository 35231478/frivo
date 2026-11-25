"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { InputData } from "@/components/ui/input-data";
import { InputHora } from "@/components/ui/input-hora";
import { MSG_HORA_INVALIDA } from "@/components/ui/input-data-hora";
import { toast } from "@/components/ui/avisos";
import { camposAlterados } from "@/lib/edicao-contexto";
import { chaveDiaCivil } from "@/lib/fuso";
import { LABELS_PRIORIDADE } from "@/lib/utils";

/** Os campos PRÓPRIOS da OS (o resto da central edita o que é de cada aba). */
const CAMPOS = ["responsavelId", "previsaoConclusao", "prazoExecucao", "prioridade", "descricao", "observacoes"] as const;
type Campo = (typeof CAMPOS)[number];

/**
 * "AAAA-MM-DD" para o campo de data. A OS chega do servidor com as datas como Date (e, depois de um
 * salvar, como texto ISO): `chaveDiaCivil` lê os dois — gravada como dia, o próprio dia; gravada com
 * hora, o dia dela em Brasília. (Cortar o texto de um Date dava "Fri Nov 20" e o campo abria vazio.)
 */
const soData = (v: Date | string | null | undefined) => (v ? chaveDiaCivil(v) : "");

/**
 * A VISITA que trouxe a OS ao calendário: a atividade agendada daquele cartão. Quando vem, a gaveta
 * ganha "Agendamento desta visita" (dia e hora) e salva pelo mesmo PATCH que o arrastar usa.
 * Técnico e equipe não entram aqui — têm lugar próprio (o painel de Atividades da OS).
 */
export interface VisitaDaGaveta {
  atividadeId: string;
  /** "AAAA-MM-DD" */
  data: string;
  /** "HH:mm" (vazio quando a visita não tem hora) */
  hora: string;
}

const dataBR = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

/**
 * Gaveta "Editar OS": os campos da própria OS (responsável, data prevista, prazo, prioridade, descrição e
 * observações) — até a Leva 5 o botão Editar do cabeçalho levava a uma rota que só voltava para cá,
 * e não havia tela nenhuma para esses campos.
 *
 * Manda só o que mudou, para o mesmo PUT /api/ordens/[id] que o resto da central usa (Ordens ›
 * editar; o servidor recusa quem não tem). Registro fechado (OS assinada, faturada ou com nota) não
 * abre: o cabeçalho mostra o cadeado com o motivo, e o servidor recusa de qualquer jeito.
 *
 * A MESMA gaveta abre do calendário (clique no cartão), com três coisas a mais, todas opcionais:
 *   • `visita`         — o agendamento daquela atividade (dia e hora), salvo pelo PATCH do arrastar;
 *   • `somenteLeitura` — quem não tem "ordens › editar", ou um registro fechado, vê tudo e não muda
 *                        nada (os campos ficam travados e o Salvar some; o motivo fica no alto);
 *   • `rodapeExtra`    — um lugar no rodapé para "Abrir a OS" (o resto da central é lá).
 */
export function EditarOs({
  os, aberto, onFechar, onAtualizado, visita, somenteLeitura = false, motivoLeitura, rodapeExtra, onReagendado,
}: {
  os: any;
  aberto: boolean;
  onFechar: () => void;
  onAtualizado: (os: any) => void;
  visita?: VisitaDaGaveta;
  somenteLeitura?: boolean;
  /** Por que está em leitura (sem permissão, registro fechado) — aparece no alto da gaveta */
  motivoLeitura?: string | null;
  rodapeExtra?: React.ReactNode;
  /** A visita mudou de dia/hora: quem abriu a gaveta atualiza o cartão sem esperar o servidor */
  onReagendado?: (v: { atividadeId: string; data: string; hora: string }) => void;
}) {
  const [usuarios, setUsuarios] = useState<{ id: string; nome: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const inicial = (): Record<Campo, string> => ({
    responsavelId: os.responsavelId ?? "",
    previsaoConclusao: soData(os.previsaoConclusao),
    prazoExecucao: soData(os.prazoExecucao),
    prioridade: os.prioridade ?? "NORMAL",
    descricao: os.descricao ?? "",
    observacoes: os.observacoes ?? "",
  });
  const [form, setForm] = useState<Record<Campo, string>>(inicial);
  const upd = (c: Campo, v: string) => setForm((f) => ({ ...f, [c]: v }));
  const [visitaData, setVisitaData] = useState(visita?.data ?? "");
  const [visitaHora, setVisitaHora] = useState(visita?.hora ?? "");
  const travado = somenteLeitura || salvando;

  // Reabrir a gaveta começa do que está gravado (descarta o rascunho de uma edição cancelada)
  useEffect(() => {
    if (aberto) { setForm(inicial()); setVisitaData(visita?.data ?? ""); setVisitaHora(visita?.hora ?? ""); setErro(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, os, visita?.atividadeId]);
  useEffect(() => {
    if (!aberto || somenteLeitura || usuarios.length) return;
    fetch("/api/usuarios", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then((l) => setUsuarios(Array.isArray(l) ? l : [])).catch(() => {});
  }, [aberto, somenteLeitura, usuarios.length]);

  const visitaMudou = !!visita && (visitaData !== visita.data || visitaHora !== visita.hora);

  // Em leitura não há botão Salvar (e o servidor recusa de qualquer jeito): salvar() só roda editando.
  async function salvar() {
    if (!form.descricao.trim()) { setErro("Descreva o serviço da OS."); return; }
    if (visitaMudou && (!visitaData || !visitaHora)) { setErro(!visitaData ? "Informe o dia da visita." : MSG_HORA_INVALIDA); return; }
    const alterados = camposAlterados(inicial(), form, CAMPOS);
    if (!alterados.length && !visitaMudou) { onFechar(); return; }
    setErro(""); setSalvando(true);
    try {
      let atualizada = os;
      if (alterados.length) {
        const corpo = Object.fromEntries(alterados.map((c) => [c, form[c as Campo] || null]));
        const res = await fetch(`/api/ordens/${os.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
        const d = await res.json().catch(() => null);
        // Recusado (sem permissão, registro fechado): a gaveta fica aberta com o que foi digitado
        if (!res.ok) { setErro((d && typeof d.erro === "string" && d.erro) || "Não foi possível salvar a OS."); return; }
        atualizada = d;
      }
      if (visita && visitaMudou) {
        // O MESMO caminho do arrastar no calendário (PATCH): dia + hora da atividade
        const res = await fetch(`/api/ordens/${os.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: visitaData, hora: visitaHora, atividadeId: visita.atividadeId }),
        });
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          const motivo = (d && typeof d.erro === "string" && d.erro) || "Não foi possível reagendar a visita.";
          setErro(alterados.length ? `Os campos da OS foram salvos, mas a visita não: ${motivo}` : motivo);
          if (alterados.length) onAtualizado(atualizada);
          return;
        }
        onReagendado?.({ atividadeId: visita.atividadeId, data: visitaData, hora: visitaHora });
        toast(alterados.length ? `OS salva e visita reagendada para ${dataBR(visitaData)} às ${visitaHora}.` : `Visita reagendada para ${dataBR(visitaData)} às ${visitaHora}.`);
      } else {
        toast("OS salva.");
      }
      onAtualizado(atualizada);
      onFechar();
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar} titulo={`${somenteLeitura ? "OS" : "Editar a OS"} ${os.chamadoNumero ?? os.numero}`}
      rodape={
        <div className="flex items-center justify-between gap-2 w-full">
          <div>{rodapeExtra}</div>
          <div className="flex justify-end gap-2">
            {somenteLeitura ? (
              <Button variant="secondary" onClick={onFechar} data-fechar-os>Fechar</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
                <Button onClick={salvar} loading={salvando} data-salvar-os>Salvar</Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4" data-editar-os data-somente-leitura={somenteLeitura || undefined}>
        {somenteLeitura && motivoLeitura && (
          <p role="note" className="text-sm text-ink-muted bg-surface-alt border border-surface-border rounded-lg px-3 py-2" data-motivo-leitura>{motivoLeitura}</p>
        )}
        {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-os>{erro}</p>}

        {visita && (
          <fieldset className="rounded-lg border border-surface-border bg-surface-alt/40 p-3 space-y-3" data-visita-gaveta>
            <legend className="px-1 text-xs font-semibold text-ink-muted uppercase tracking-wider">Agendamento desta visita</legend>
            <FormGrid>
              <FormField label="Dia da visita" dica="O dia desta atividade no calendário. Mudar aqui é o mesmo que arrastar o cartão.">
                <InputData aria-label="Dia da visita" value={visitaData} onChange={setVisitaData} disabled={travado} />
              </FormField>
              <FormField label="Hora da visita" dica="O horário combinado com o cliente. Técnico e equipe se mudam no painel de Atividades da OS.">
                <InputHora aria-label="Hora da visita" value={visitaHora} onChange={setVisitaHora} disabled={travado} invalido={!!erro && visitaMudou && !visitaHora} />
              </FormField>
            </FormGrid>
          </fieldset>
        )}

        <FormGrid>
          <FormField label="Responsável" dica="Quem responde pela OS no escritório. O cadastro de usuários fica em Configurações › Usuários (criar um dá acesso ao sistema).">
            <Select value={form.responsavelId} onChange={(e) => upd("responsavelId", e.target.value)} placeholder="Sem responsável" disabled={travado} data-responsavel-os>
              {[...usuarios, ...(os.responsavel && !usuarios.some((u) => u.id === os.responsavelId) ? [{ id: os.responsavelId, nome: os.responsavel.nome }] : [])]
                .map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </Select>
          </FormField>
          <FormField label="Data prevista" dica="O dia em que o serviço está marcado, quando a OS ainda não tem atividade agendada. É a agenda, não o prazo.">
            <InputData aria-label="Data prevista" value={form.previsaoConclusao} onChange={(v) => upd("previsaoConclusao", v)} disabled={travado} />
          </FormField>
          <FormField label="Prazo para finalizar" dica="Até que dia a OS precisa estar concluída. Depois dele, a OS é sinalizada como atrasada. Vazio: vale a data prevista.">
            <InputData aria-label="Prazo para finalizar" value={form.prazoExecucao} onChange={(v) => upd("prazoExecucao", v)} disabled={travado} />
          </FormField>
        </FormGrid>
        <FormField label="Prioridade">
          <Select value={form.prioridade} onChange={(e) => upd("prioridade", e.target.value)} className="sm:max-w-xs" disabled={travado} data-prioridade-os>
            {Object.entries(LABELS_PRIORIDADE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
        <FormField label="Descrição" required={!somenteLeitura}>
          <Textarea value={form.descricao} onChange={(e) => upd("descricao", e.target.value)} rows={3} disabled={travado} data-descricao-os />
        </FormField>
        <FormField label="Observações">
          <Textarea value={form.observacoes} onChange={(e) => upd("observacoes", e.target.value)} rows={2} disabled={travado} data-observacoes-os />
        </FormField>
      </div>
    </Drawer>
  );
}
