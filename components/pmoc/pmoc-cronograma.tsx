"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Info, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { cn, LABELS_STATUS_OS, LABELS_TRATAMENTO_FIM_SEMANA } from "@/lib/utils";
import { chaveDiaBR } from "@/lib/fuso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputData } from "@/components/ui/input-data";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Dica } from "@/components/ui/dica";
import { StatusPill, TOM_ESTAGIO_OS } from "@/components/ui/status-pill";
import { confirmar, toast } from "@/components/ui/avisos";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { dataBR, hojeISO } from "@/lib/pmoc";
import {
  DIA_EXECUCAO_MAX, FIM_SEMANA_CURTO, FIM_SEMANA_PADRAO, FINS_DE_SEMANA, FREQUENCIAS, INTERVALO_MESES_MAX, TEXTO_SEM_GERAR, escopoDoItem,
  ocorrenciasDoItem, rotuloFrequencia, textoResultado, type EscopoItem, type FimSemana, type ResumoPlano,
} from "@/lib/pmoc-cronograma";
import type { CronogramaTela, ItemCronogramaTela, OsDoCronograma } from "@/lib/pmoc-cronograma-server";

/** A quem o item se aplica, por extenso */
function rotuloEscopo(i: ItemCronogramaTela): string {
  if (i.equipamento) return [i.equipamento.patrimonio, i.equipamento.nome || `${i.equipamento.marca} ${i.equipamento.modelo}`.trim()].filter(Boolean).join(" · ");
  return i.tipoEquipamento ? i.tipoEquipamento.nome : "Todos os equipamentos";
}
const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);
/** "2 execuções substituídas" — o que o item cede, de hoje em diante, a um item de maior intervalo */
const cedidas = (i: ItemCronogramaTela) => plural(i.substituidas, "execução substituída", "execuções substituídas");

/** As mudanças pendentes, uma por linha (o que "Reagendar atividades" vai fazer) */
function linhasDaPrevia(p: ResumoPlano): string[] {
  // Dos retirados: os que passam a ser atendidos por um item de maior intervalo, e os que saíram do cronograma
  const cedidos = plural(p.substituidos, "equipamento atendido", "equipamentos atendidos");
  const fora = plural(p.retirar - p.substituidos, "equipamento que saiu", "equipamentos que saíram");
  return [
    p.criar > 0 && `Criar ${plural(p.criar, "OS", "OS")}`,
    p.incluir > 0 && `Incluir ${plural(p.incluir, "equipamento", "equipamentos")} em OS já geradas`,
    p.mover > 0 && `Mudar a data de ${plural(p.mover, "OS", "OS")}`,
    p.substituidos > 0 && `Retirar ${cedidos} por outro serviço`,
    p.retirar > p.substituidos && `Retirar ${fora} do cronograma`,
    p.cancelar > 0 && `Cancelar ${plural(p.cancelar, "OS que fica", "OS que ficam")} sem equipamento`,
  ].filter((l): l is string => !!l);
}
const temPendencia = (p: ResumoPlano) => p.criar + p.incluir + p.mover + p.retirar + p.cancelar > 0;

interface FormItem { escopo: EscopoItem; tipoEquipamentoId: string; equipamentoId: string; tipoOsId: string; dataInicio: string; intervaloMeses: string; diaExecucao: string; fimSemana: FimSemana }

/** A regra da substituição, na dica da lista de itens */
const AJUDA_SUBSTITUICAO = (
  <>
    Quando dois itens pegam o mesmo equipamento no mesmo mês, só o de maior intervalo gera OS:
    {" "}a limpeza semestral substitui a preventiva mensal. No empate, vale o item criado primeiro.
  </>
);
/** O que a substituição pede do checklist, na dica do tipo de OS */
const AJUDA_TIPO_OS = (
  <>
    Define o serviço e o checklist da OS gerada. O serviço de maior intervalo substitui os outros no mês:
    {" "}o checklist dele deve incluir também a rotina leve. Os tipos ficam em Configurações.
  </>
);

/**
 * Aba "Cronograma" do PMOC (Etapa 2): os itens que dizem o que fazer, em quem e de quanto em quanto
 * tempo — e as OS que o cronograma gerou. As regras ficam em lib/pmoc-cronograma.
 */
export function PmocCronograma({ pmocId, dataExpiracao, somenteLeitura }: { pmocId: string; dataExpiracao: string; somenteLeitura: boolean }) {
  const { pode } = usePermissoes();
  const [dados, setDados] = useState<CronogramaTela | null>(null);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState<ItemCronogramaTela | "novo" | null>(null);
  const [reagendando, setReagendando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const url = `/api/pmocs/${pmocId}/cronograma`;

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) { setErro(d?.erro ?? "Não foi possível carregar o cronograma."); return; }
      setDados(d); setErro("");
    } catch { setErro("Erro de conexão."); }
  }, [url]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function excluir(item: ItemCronogramaTela) {
    if (!(await confirmar({ titulo: "Excluir item do cronograma?", mensagem: "As OS futuras deste item saem da agenda ao reagendar as atividades.", confirmarTexto: "Excluir", perigo: true }))) return;
    setOcupado(true);
    try {
      const res = await fetch(`${url}/${item.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d.erro ?? "Não foi possível excluir o item.", "erro"); return; }
      setDados(d.cronograma); toast("Item excluído do cronograma.");
    } catch { toast("Erro de conexão.", "erro"); } finally { setOcupado(false); }
  }

  if (erro && !dados) return <p data-erro-cronograma className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">{erro}</p>;
  if (!dados) return <p className="flex items-center justify-center gap-2 text-sm text-ink-muted py-10"><Loader2 className="w-4 h-4 animate-spin" /> Carregando o cronograma…</p>;

  const pendente = temPendencia(dados.previa);
  const semItens = dados.itens.length === 0;
  const fora = dados.opcoes.equipamentos.filter((e) => dados.semCronograma.includes(e.id));
  const acoes = (i: ItemCronogramaTela) => !somenteLeitura && (
    <div className="flex items-center justify-end gap-0.5">
      <button type="button" title="Editar item" aria-label="Editar item" disabled={ocupado} onClick={() => setEditando(i)} className="p-1.5 rounded-md text-ink-muted hover:text-acento hover:bg-surface-alt disabled:opacity-50"><Pencil className="w-4 h-4" /></button>
      <button type="button" title="Excluir item" aria-label="Excluir item" disabled={ocupado} onClick={() => excluir(i)} className="p-1.5 rounded-md text-ink-muted hover:text-atrasado hover:bg-atrasado-claro disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
    </div>
  );

  return (
    <div>
    <div className="space-y-5" data-cronograma>
      {dados.motivo && (
        <p data-sem-gerar={dados.motivo} className="flex items-start gap-2 text-sm text-previsto-texto bg-previsto-claro rounded-lg px-3 py-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" /> {TEXTO_SEM_GERAR[dados.motivo]}
        </p>
      )}

      {/* Itens do cronograma */}
      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h2 className="font-semibold text-ink flex items-center gap-1.5">Itens do cronograma ({dados.itens.length}) <Dica texto={AJUDA_SUBSTITUICAO} rotulo="Itens do cronograma" lado="direita" /></h2>
            <p className="text-xs text-ink-muted" data-regra-substituicao>Uma OS por execução e por local. No mesmo mês, vale o item de maior intervalo.</p>
          </div>
          {!somenteLeitura && <Button type="button" size="sm" onClick={() => setEditando("novo")} data-novo-item><Plus className="w-4 h-4" /> Novo item</Button>}
        </div>
        {semItens ? (
          <p className="text-sm text-ink-muted text-center py-8 px-4" data-sem-itens>Nenhum item no cronograma.{!somenteLeitura && " Crie o primeiro em “Novo item”."}</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm" data-tabela-itens>
                <thead className="bg-surface-alt text-xs uppercase tracking-wider text-ink-muted text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Aplica-se a</th><th className="px-4 py-2.5 font-semibold">Tipo de OS</th>
                    <th className="px-4 py-2.5 font-semibold">Início</th><th className="px-4 py-2.5 font-semibold">Frequência</th>
                    <th className="px-4 py-2.5 font-semibold">Dia</th><th className="px-4 py-2.5 font-semibold">Próxima execução</th><th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((i) => (
                    <tr key={i.id} data-item={i.id} className="border-t border-surface-border">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-ink">{rotuloEscopo(i)}</span>
                        <span className="block text-xs text-ink-muted">{plural(i.equipamentos, "equipamento", "equipamentos")}</span>
                        {i.substituidas > 0 && <span className="block text-xs text-ink-muted" data-substituidas>{cedidas(i)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted">{i.tipoOs.nome}</td>
                      <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{dataBR(i.dataInicio)}</td>
                      <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{rotuloFrequencia(i.intervaloMeses)}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{i.diaExecucao}</td>
                      <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">
                        {i.proxima ? dataBR(i.proxima) : "—"}
                        {i.fimSemana !== "MANTER" && <span className="block text-xs" data-fim-semana={i.fimSemana}>{FIM_SEMANA_CURTO[i.fimSemana]}</span>}
                      </td>
                      <td className="px-2">{acoes(i)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden divide-y divide-surface-border">
              {dados.itens.map((i) => (
                <li key={i.id} data-item-card={i.id} className="px-4 py-3 flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium text-ink">{rotuloEscopo(i)} <span className="font-normal text-ink-muted">· {plural(i.equipamentos, "equipamento", "equipamentos")}</span></p>
                    <p className="text-xs text-ink-muted">{i.tipoOs.nome} · {rotuloFrequencia(i.intervaloMeses)}, dia {i.diaExecucao}{i.fimSemana !== "MANTER" ? ` (${FIM_SEMANA_CURTO[i.fimSemana]})` : ""}</p>
                    <p className="text-xs text-ink-muted">Início {dataBR(i.dataInicio)} · Próxima {i.proxima ? dataBR(i.proxima) : "—"}</p>
                    {i.substituidas > 0 && <p className="text-xs text-ink-muted" data-substituidas>{cedidas(i)}</p>}
                  </div>
                  {acoes(i)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {!semItens && fora.length > 0 && (
        <div data-fora-do-cronograma className="flex items-start gap-2 text-sm text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span><strong>{plural(fora.length, "equipamento do plano está", "equipamentos do plano estão")} fora do cronograma:</strong> {fora.map((e) => e.rotulo).join("; ")}.</span>
        </div>
      )}

      {/* OS geradas */}
      <div className="bg-white border border-surface-border rounded-xl overflow-hidden" data-atividades-geradas>
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h2 className="font-semibold text-ink">Atividades geradas</h2>
            <p className="text-xs text-ink-muted" data-totais>{plural(dados.totais.futuras, "OS por vir", "OS por vir")} · {plural(dados.totais.passadas, "anterior", "anteriores")}</p>
          </div>
          {!somenteLeitura && (
            <Button type="button" size="sm" variant={pendente ? "primary" : "secondary"} disabled={!!dados.motivo || semItens && !pendente} onClick={() => setReagendando(true)} data-reagendar
              title={dados.motivo ? TEXTO_SEM_GERAR[dados.motivo] : undefined}>
              <RefreshCw className="w-4 h-4" /> Reagendar atividades
            </Button>
          )}
        </div>
        {pendente && (
          <p data-pendencias className="flex items-start gap-2 text-sm text-atencao-texto bg-atencao-claro px-4 py-2 border-b border-atencao/20">
            <CalendarClock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>A agenda está diferente do cronograma. {somenteLeitura ? "Falta reagendar as atividades." : "Use “Reagendar atividades” para acertar."}</span>
          </p>
        )}
        {dados.ordens.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-8 px-4" data-sem-os>Nenhuma OS gerada por este cronograma.</p>
        ) : (
          <ListaDeOs ordens={dados.ordens} podeAbrir={pode("ordens", "visualizar")} />
        )}
      </div>
    </div>

      {/* Os diálogos ficam FORA de qualquer bloco com space-y (a margem entre blocos deslocaria a camada fixa) */}
      {editando && (
        <ModalItem
          item={editando === "novo" ? null : editando} dados={dados} dataExpiracao={dataExpiracao} url={url}
          onFechar={() => setEditando(null)}
          onSalvo={(c, texto) => { setDados(c); setEditando(null); toast(texto); }}
        />
      )}
      {reagendando && (
        <ModalReagendar
          previa={dados.previa} url={url} podeCancelarOs={pode("ordens", "excluir")}
          onFechar={() => setReagendando(false)}
          onFeito={(c, texto, tipo) => { setDados(c); setReagendando(false); toast(texto, tipo); }}
        />
      )}
    </div>
  );
}

function ListaDeOs({ ordens, podeAbrir }: { ordens: OsDoCronograma[]; podeAbrir: boolean }) {
  const hoje = hojeISO();
  const numero = (o: OsDoCronograma) => (podeAbrir
    ? <Link href={`/ordens/${o.id}`} className="font-medium text-acento hover:underline">{o.numero}</Link>
    : <span className="font-medium text-ink">{o.numero}</span>);
  const data = (o: OsDoCronograma) => (o.data ? dataBR(chaveDiaBR(o.data)) : "—");
  const passada = (o: OsDoCronograma) => !!o.data && chaveDiaBR(o.data) < hoje;
  return (
    <>
      <div className="hidden md:block overflow-x-auto max-h-[28rem] overflow-y-auto">
        <table className="w-full text-sm" data-tabela-os>
          <thead className="bg-surface-alt text-xs uppercase tracking-wider text-ink-muted text-left sticky top-0">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Data</th><th className="px-4 py-2.5 font-semibold">OS</th><th className="px-4 py-2.5 font-semibold">Tipo de OS</th>
              <th className="px-4 py-2.5 font-semibold">Local</th><th className="px-4 py-2.5 font-semibold">Equipamentos</th><th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {ordens.map((o) => (
              <tr key={o.id} data-os={o.id} data-periodo={o.periodo} className={cn("border-t border-surface-border", passada(o) && "text-ink-muted")}>
                <td className="px-4 py-2.5 whitespace-nowrap">{data(o)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{numero(o)}</td>
                <td className="px-4 py-2.5 text-ink-muted">{o.tipoOs}</td>
                <td className="px-4 py-2.5 text-ink-muted">{o.local ?? "—"}</td>
                <td className="px-4 py-2.5 text-ink-muted">{o.equipamentos}</td>
                <td className="px-4 py-2.5"><StatusPill tom={TOM_ESTAGIO_OS[o.status] ?? "previsto"} tamanho="sm">{LABELS_STATUS_OS[o.status] ?? o.status}</StatusPill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden divide-y divide-surface-border">
        {ordens.map((o) => (
          <li key={o.id} data-os-card={o.id} className="px-4 py-3 flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm text-ink">{data(o)} · {numero(o)}</p>
              <p className="text-xs text-ink-muted">{o.tipoOs} · {o.local ?? "—"} · {plural(o.equipamentos, "equipamento", "equipamentos")}</p>
            </div>
            <StatusPill tom={TOM_ESTAGIO_OS[o.status] ?? "previsto"} tamanho="sm">{LABELS_STATUS_OS[o.status] ?? o.status}</StatusPill>
          </li>
        ))}
      </ul>
    </>
  );
}

function ModalItem({ item, dados, dataExpiracao, url, onFechar, onSalvo }: {
  item: ItemCronogramaTela | null; dados: CronogramaTela; dataExpiracao: string; url: string;
  onFechar: () => void; onSalvo: (c: CronogramaTela, texto: string) => void;
}) {
  const [f, setF] = useState<FormItem>(() => ({
    escopo: item ? escopoDoItem(item) : "TODOS",
    tipoEquipamentoId: item?.tipoEquipamentoId ?? "", equipamentoId: item?.equipamentoId ?? "",
    tipoOsId: item?.tipoOsId ?? (dados.opcoes.tiposOs.length === 1 ? dados.opcoes.tiposOs[0].id : ""),
    dataInicio: item?.dataInicio ?? hojeISO(), intervaloMeses: String(item?.intervaloMeses ?? 1), diaExecucao: String(item?.diaExecucao ?? ""),
    fimSemana: item?.fimSemana ?? FIM_SEMANA_PADRAO,
  }));
  const set = <K extends keyof FormItem>(k: K, v: FormItem[K]) => setF((x) => ({ ...x, [k]: v }));
  /** Há outro item no plano? Então a substituição pode valer para este */
  const outrosItens = dados.itens.filter((i) => i.id !== item?.id).length;
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // O que já está gravado continua escolhível mesmo que tenha saído das opções (tipo inativado, equipamento inativo)
  const tiposOs = useMemo(() => (item && !dados.opcoes.tiposOs.some((t) => t.id === item.tipoOsId) ? [...dados.opcoes.tiposOs, { id: item.tipoOs.id, nome: item.tipoOs.nome }] : dados.opcoes.tiposOs), [item, dados.opcoes.tiposOs]);
  const tiposEquip = useMemo(() => (item?.tipoEquipamento && !dados.opcoes.tiposEquipamento.some((t) => t.id === item.tipoEquipamento!.id)
    ? [...dados.opcoes.tiposEquipamento, { ...item.tipoEquipamento, equipamentos: 0 }] : dados.opcoes.tiposEquipamento), [item, dados.opcoes.tiposEquipamento]);

  const intervalo = Number(f.intervaloMeses);
  const dia = Number(f.diaExecucao);
  const frequencia = FREQUENCIAS.some((x) => x.meses === intervalo) ? String(intervalo) : "outro";
  const proximas = useMemo(() => {
    if (!f.dataInicio || !Number.isInteger(intervalo) || intervalo < 1 || !Number.isInteger(dia) || dia < 1 || dia > DIA_EXECUCAO_MAX) return [];
    const hoje = hojeISO();
    return ocorrenciasDoItem({ dataInicio: f.dataInicio, intervaloMeses: intervalo, diaExecucao: dia, fimSemana: f.fimSemana }, dataExpiracao).map((o) => chaveDiaBR(o.data)).filter((d) => d >= hoje);
  }, [f.dataInicio, intervalo, dia, f.fimSemana, dataExpiracao]);

  async function salvar() {
    setErro("");
    if (f.escopo === "TIPO" && !f.tipoEquipamentoId) { setErro("Selecione o tipo de equipamento."); return; }
    if (f.escopo === "EQUIPAMENTO" && !f.equipamentoId) { setErro("Selecione o equipamento."); return; }
    setSalvando(true);
    try {
      const res = await fetch(item ? `${url}/${item.id}` : url, {
        method: item ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoEquipamentoId: f.escopo === "TIPO" ? f.tipoEquipamentoId : null, equipamentoId: f.escopo === "EQUIPAMENTO" ? f.equipamentoId : null,
          tipoOsId: f.tipoOsId, dataInicio: f.dataInicio, intervaloMeses: f.intervaloMeses === "" ? NaN : intervalo, diaExecucao: f.diaExecucao === "" ? NaN : dia,
          fimSemana: f.fimSemana,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível salvar o item."); return; }
      const geradas = d.gerado ? textoResultado(d.gerado) : "";
      onSalvo(d.cronograma, `Item ${item ? "salvo" : "criado"}.${geradas ? ` ${geradas}.` : ""}`);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto onFechar={onFechar} titulo={item ? "Editar item do cronograma" : "Novo item do cronograma"} tamanho="lg">
      <div className="space-y-4" data-form-item>
        {erro && <p role="alert" data-erro-item className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">{erro}</p>}
        <FormGrid>
          <FormField label="Aplica-se a" required>
            <Select aria-label="Aplica-se a" value={f.escopo} onChange={(e) => set("escopo", e.target.value as EscopoItem)}>
              <option value="TODOS">Todos os equipamentos do plano</option>
              <option value="TIPO">Um tipo de equipamento</option>
              <option value="EQUIPAMENTO">Um equipamento</option>
            </Select>
          </FormField>
          {f.escopo === "TIPO" && (
            <FormField label="Tipo de equipamento" required>
              <Select aria-label="Tipo de equipamento" value={f.tipoEquipamentoId} onChange={(e) => set("tipoEquipamentoId", e.target.value)} placeholder="Selecione o tipo">
                {tiposEquip.map((t) => <option key={t.id} value={t.id}>{t.nome} ({t.equipamentos})</option>)}
              </Select>
            </FormField>
          )}
          {f.escopo === "EQUIPAMENTO" && (
            <FormField label="Equipamento" required>
              <Select aria-label="Equipamento" value={f.equipamentoId} onChange={(e) => set("equipamentoId", e.target.value)} placeholder="Selecione o equipamento">
                {dados.opcoes.equipamentos.map((e) => <option key={e.id} value={e.id}>{e.rotulo}{e.local ? ` — ${e.local}` : ""}</option>)}
              </Select>
            </FormField>
          )}
        </FormGrid>
        <FormGrid>
          <FormField label="Tipo de OS" required dica={AJUDA_TIPO_OS}>
            <Select aria-label="Tipo de OS" value={f.tipoOsId} onChange={(e) => set("tipoOsId", e.target.value)} placeholder="Selecione o tipo de OS">
              {tiposOs.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </Select>
          </FormField>
          <FormField label="Data de início" required>
            <InputData aria-label="Data de início" value={f.dataInicio} onChange={(iso) => set("dataInicio", iso)} />
          </FormField>
        </FormGrid>
        <FormGrid cols={3}>
          <FormField label="Frequência" required>
            <Select aria-label="Frequência" value={frequencia} onChange={(e) => { if (e.target.value !== "outro") set("intervaloMeses", e.target.value); else if (frequencia !== "outro") set("intervaloMeses", "4"); }}>
              {FREQUENCIAS.map((x) => <option key={x.meses} value={x.meses}>{x.rotulo}</option>)}
              <option value="outro">Outro intervalo</option>
            </Select>
          </FormField>
          <FormField label="A cada (meses)" required>
            <Input aria-label="A cada quantos meses" type="number" inputMode="numeric" min={1} max={INTERVALO_MESES_MAX} step={1} value={f.intervaloMeses} onChange={(e) => set("intervaloMeses", e.target.value)} />
          </FormField>
          <FormField label="Dia de execução" required hint="De 1 a 28">
            <Input aria-label="Dia de execução" type="number" inputMode="numeric" min={1} max={DIA_EXECUCAO_MAX} step={1} value={f.diaExecucao} onChange={(e) => set("diaExecucao", e.target.value)} placeholder="Ex: 25" />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Se cair no fim de semana" required dica="Vale quando o dia de execução cai em sábado ou domingo. Feriados não entram na conta.">
            <Select aria-label="Se cair no fim de semana" value={f.fimSemana} onChange={(e) => set("fimSemana", e.target.value as FimSemana)}>
              {FINS_DE_SEMANA.map((v) => <option key={v} value={v}>{LABELS_TRATAMENTO_FIM_SEMANA[v]}</option>)}
            </Select>
          </FormField>
        </FormGrid>
        <p data-proximas className="text-xs text-ink-muted">
          {proximas.length
            ? <>Próximas execuções: <strong className="text-ink">{proximas.slice(0, 4).map((d) => dataBR(d)).join(", ")}</strong>{proximas.length > 4 ? ` e mais ${proximas.length - 4}` : ""}. Vão até a expiração do plano ({dataBR(dataExpiracao)}).</>
            : "Sem execução dentro da validade do plano com estes dados."}
        </p>
        {outrosItens > 0 && (
          <p data-aviso-substituicao className="text-xs text-ink-muted">No mês em que um item de maior intervalo atender o mesmo equipamento, este não gera OS.</p>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar} data-salvar-item>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}

function ModalReagendar({ previa, url, podeCancelarOs, onFechar, onFeito }: {
  previa: ResumoPlano; url: string; podeCancelarOs: boolean;
  onFechar: () => void; onFeito: (c: CronogramaTela, texto: string, tipo: "sucesso" | "info") => void;
}) {
  const [erro, setErro] = useState("");
  const [rodando, setRodando] = useState(false);
  const linhas = linhasDaPrevia(previa);

  async function reagendar() {
    setErro(""); setRodando(true);
    try {
      const res = await fetch(`${url}/reagendar`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível reagendar."); return; }
      const texto = textoResultado(d.resultado);
      const n = Number(d.resultado.aCancelar) || 0;
      const resta = n ? ` ${plural(n, "OS ficou", "OS ficaram")} sem equipamento, à espera de quem pode cancelar OS.` : "";
      onFeito(d.cronograma, (texto ? `Agenda atualizada: ${texto}.` : "A agenda já estava igual ao cronograma.") + resta, texto ? "sucesso" : "info");
    } catch { setErro("Erro de conexão."); } finally { setRodando(false); }
  }

  return (
    <Modal aberto onFechar={onFechar} titulo="Reagendar atividades" tamanho="sm">
      <div className="space-y-4" data-modal-reagendar>
        <p className="text-sm text-ink">A agenda fica igual ao cronograma. Só muda a OS que ainda não começou; nada é criado em dobro.</p>
        {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">{erro}</p>}
        {linhas.length ? (
          <ul data-previa className="text-sm text-ink bg-surface-alt rounded-lg px-3 py-2 space-y-1 list-disc list-inside">
            {linhas.map((l) => <li key={l}>{l}</li>)}
          </ul>
        ) : <p data-previa-vazia className="text-sm text-ink-muted bg-surface-alt rounded-lg px-3 py-2">A agenda já está igual ao cronograma.</p>}
        {previa.mantidas > 0 && <p data-mantidas className="text-xs text-ink-muted">{plural(previa.mantidas, "OS com data ajustada à mão fica como está", "OS com data ajustada à mão ficam como estão")}.</p>}
        {previa.cancelar > 0 && !podeCancelarOs && (
          <p data-sem-cancelar className="text-xs text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2">Cancelar OS exige a permissão Ordens de serviço › Excluir. Essas OS ficam como estão.</p>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={onFechar}>{linhas.length ? "Voltar" : "Fechar"}</Button>
          {linhas.length > 0 && <Button type="button" loading={rodando} onClick={reagendar} data-confirmar-reagendar><RefreshCw className="w-4 h-4" /> Reagendar</Button>}
        </div>
      </div>
    </Modal>
  );
}
