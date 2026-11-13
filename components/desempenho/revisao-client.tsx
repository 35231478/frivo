"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Loader2, Pencil, Plus, Trash2, Undo2, XCircle } from "lucide-react";
import { formatarData } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InputData } from "@/components/ui/input-data";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { chaveDiaBR, chaveHojeBR } from "@/lib/fuso";
import {
  DESCRICAO_MAX, MOTIVO_MAX, MOTIVO_MIN, MSG_MOTIVO, ROTULO_PENALIDADE, ROTULO_SITUACAO, SITUACOES_PENALIDADE, competenciaCurta,
  type SituacaoPenalidade, type TipoPenalidade,
} from "@/lib/desempenho/regras";
import type { ListaDePenalidades, PenalidadeNaLista } from "@/lib/desempenho/penalidades-server";
import { CabecalhoDesempenho, Erro, JSON_HEADERS, type PodeDesempenho } from "./comum";

const TOM_SITUACAO: Record<SituacaoPenalidade, TomStatus> = { A_REVISAR: "atencao", CONTA: "atrasado", NAO_CONTA: "previsto" };
const TOM_TIPO: Record<TipoPenalidade, TomStatus> = { RETORNO: "acento", RESSALVA: "atencao", RECLAMACAO: "previsto" };
type Filtro = SituacaoPenalidade | "";

/**
 * Lista "A revisar": retorno, ressalva, nota baixa e reclamação. Nada pesa no escore sozinho — só
 * depois de alguém marcar "Conta", com motivo. "Não conta" também pede motivo; dá para rever.
 */
export function RevisaoDesempenho({ pode }: { pode: PodeDesempenho }) {
  const [filtro, setFiltro] = useState<Filtro>("A_REVISAR");
  const [dados, setDados] = useState<(ListaDePenalidades & { ativo: boolean }) | null>(null);
  const [erro, setErro] = useState("");
  const [decidindo, setDecidindo] = useState<{ item: PenalidadeNaLista; situacao: "CONTA" | "NAO_CONTA" } | null>(null);
  const [formulario, setFormulario] = useState<PenalidadeNaLista | "nova" | null>(null);
  const [excluindo, setExcluindo] = useState<PenalidadeNaLista | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  const carregar = useCallback(async (situacao: Filtro) => {
    setErro("");
    try {
      const r = await fetch(`/api/desempenho/penalidades${situacao ? `?situacao=${situacao}` : ""}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível carregar a lista."); return; }
      setDados(d);
    } catch { setErro("Erro de conexão."); }
  }, []);
  useEffect(() => { void carregar(filtro); }, [carregar, filtro]);

  /** Volta a decisão para "a revisar" (um clique) */
  async function rever(item: PenalidadeNaLista) {
    setOcupada(item.id); setErro("");
    try {
      const r = await fetch(`/api/desempenho/penalidades/${item.id}/decisao`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ situacao: "A_REVISAR" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível rever a decisão."); return; }
      await carregar(filtro);
    } catch { setErro("Erro de conexão."); } finally { setOcupada(null); }
  }
  const aposMudar = () => { setDecidindo(null); setFormulario(null); setExcluindo(null); void carregar(filtro); };

  return (
    <div className="space-y-4" data-revisao-desempenho>
      <CabecalhoDesempenho ativa="revisao" pode={pode} aRevisar={dados?.aRevisar}
        acoes={dados?.ativo ? <Button type="button" size="sm" onClick={() => setFormulario("nova")} data-nova-reclamacao><Plus className="w-4 h-4" /> Registrar reclamação</Button> : undefined} />

      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted max-w-2xl">
            Retorno e ressalva sem nota entram aqui sozinhos. Só pesam depois de marcados “Conta”, com motivo.
          </p>
          <Select aria-label="Situação" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} className="w-44" data-filtro-situacao>
            {SITUACOES_PENALIDADE.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>)}
            <option value="">Todas</option>
          </Select>
        </div>
        {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border-b border-atrasado/20 px-4 py-2" data-erro-revisao>{erro}</p>}
        {!dados ? (!erro && <p className="text-sm text-ink-muted px-4 py-6 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>)
          : !dados.ativo ? <p className="text-sm text-ink-muted px-4 py-8 text-center" data-revisao-inativa>O Desempenho ainda não foi configurado nesta empresa.</p>
          : dados.itens.length === 0 ? (
            <div className="text-center px-4 py-10 space-y-2" data-revisao-vazia>
              <ClipboardCheck className="w-6 h-6 text-ink-subtle mx-auto" aria-hidden />
              <p className="text-sm text-ink-muted">{filtro === "A_REVISAR" ? "Nada esperando revisão." : "Nenhum item nesta situação."}</p>
            </div>
          ) : (
            <ul className="divide-y divide-surface-border" data-lista-revisao>
              {dados.itens.map((p) => (
                <li key={p.id} className="px-4 py-3 flex flex-col lg:flex-row lg:items-start gap-2 lg:gap-4" data-penalidade={p.id} data-tipo={p.tipo} data-situacao={p.situacao}>
                  <div className="lg:w-28 shrink-0">
                    <p className="text-sm font-medium text-ink tabular-nums">{formatarData(p.dataFato)}</p>
                    <p className="text-xs text-ink-muted">Pesa em {competenciaCurta(p.competencia)}</p>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-semibold text-ink break-words">
                      <Link href={`/desempenho/colaborador/${p.tecnico.id}?mes=${p.competencia}`} className="hover:underline" data-penalidade-colaborador>{p.tecnico.nome}</Link>
                    </p>
                    {p.descricao && <p className="text-sm text-ink whitespace-pre-line break-words" data-penalidade-descricao>{p.descricao}</p>}
                    <p className="text-xs flex flex-wrap gap-x-4 gap-y-1">
                      {p.ordemServico && <Link href={`/ordens/${p.ordemServico.id}`} className="text-primary-600 hover:underline" data-penalidade-os>Serviço: {p.ordemServico.numero}</Link>}
                      {p.osRetorno && <Link href={`/ordens/${p.osRetorno.id}`} className="text-primary-600 hover:underline" data-penalidade-retorno>Corretiva: {p.osRetorno.numero}</Link>}
                      {p.criadoPor && <span className="text-ink-muted">Registrada por {p.criadoPor}</span>}
                    </p>
                    {p.motivo && (
                      <p className="text-xs text-ink-muted break-words" data-penalidade-motivo>
                        Decisão de {p.revisadoPor ?? "alguém que saiu do sistema"}{p.revisadoEm ? ` em ${formatarData(p.revisadoEm)}` : ""}: {p.motivo}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap lg:w-44 lg:justify-end shrink-0">
                    <StatusPill tom={TOM_TIPO[p.tipo] ?? "previsto"} tamanho="sm">{ROTULO_PENALIDADE[p.tipo] ?? p.tipo}</StatusPill>
                    <StatusPill tom={TOM_SITUACAO[p.situacao] ?? "previsto"} tamanho="sm" data-pilula-situacao={p.situacao}>{ROTULO_SITUACAO[p.situacao] ?? p.situacao}</StatusPill>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap lg:w-64 lg:justify-end shrink-0" data-acoes-penalidade>
                    {p.situacao === "A_REVISAR" ? (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={() => setDecidindo({ item: p, situacao: "CONTA" })} data-conta><CheckCircle2 className="w-3.5 h-3.5" /> Conta</Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setDecidindo({ item: p, situacao: "NAO_CONTA" })} data-nao-conta><XCircle className="w-3.5 h-3.5" /> Não conta</Button>
                      </>
                    ) : (
                      <Button type="button" variant="secondary" size="sm" loading={ocupada === p.id} onClick={() => rever(p)} data-rever><Undo2 className="w-3.5 h-3.5" /> Rever decisão</Button>
                    )}
                    {p.manual && (
                      <>
                        <button type="button" title="Editar reclamação" aria-label="Editar reclamação" onClick={() => setFormulario(p)} data-editar
                          className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-alt"><Pencil className="w-4 h-4" /></button>
                        <button type="button" title="Excluir reclamação" aria-label="Excluir reclamação" onClick={() => setExcluindo(p)} data-excluir
                          className="p-1.5 rounded-md text-ink-muted hover:text-atrasado hover:bg-atrasado-claro"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>

      {decidindo && <Decisao key={`${decidindo.item.id}-${decidindo.situacao}`} {...decidindo} aoFechar={() => setDecidindo(null)} aoSalvar={aposMudar} />}
      {formulario && dados && (
        <Reclamacao key={formulario === "nova" ? "nova" : formulario.id} item={formulario === "nova" ? null : formulario} colaboradores={dados.colaboradores}
          aoFechar={() => setFormulario(null)} aoSalvar={aposMudar} />
      )}
      {excluindo && <Excluir key={excluindo.id} item={excluindo} aoFechar={() => setExcluindo(null)} aoSalvar={aposMudar} />}
    </div>
  );
}

interface PropsDialogo { aoFechar: () => void; aoSalvar: () => void }

function Decisao({ item, situacao, aoFechar, aoSalvar }: PropsDialogo & { item: PenalidadeNaLista; situacao: "CONTA" | "NAO_CONTA" }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const conta = situacao === "CONTA";

  async function salvar() {
    if (motivo.trim().length < MOTIVO_MIN) { setErro(MSG_MOTIVO); return; }
    setErro(""); setSalvando(true);
    try {
      const r = await fetch(`/api/desempenho/penalidades/${item.id}/decisao`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ situacao, motivo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível gravar a decisão."); return; }
      aoSalvar();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto onFechar={aoFechar} titulo={conta ? "Conta no escore" : "Não conta no escore"}>
      <div className="space-y-4" data-modal-decisao={situacao}>
        <p className="text-sm text-ink">
          <span className="font-medium">{item.tecnico.nome}</span> · {ROTULO_PENALIDADE[item.tipo]} em {formatarData(item.dataFato)}
        </p>
        {item.descricao && <p className="text-sm text-ink-muted whitespace-pre-line break-words">{item.descricao}</p>}
        <p className="text-sm text-ink-muted">
          {conta ? `Desconta pontos do escore de ${competenciaCurta(item.competencia)}.` : "Fica registrado e não desconta nada do escore."}
        </p>
        <FormField label="Motivo da decisão" required hint="Fica gravado com o nome de quem decidiu.">
          <Textarea aria-label="Motivo da decisão" rows={3} maxLength={MOTIVO_MAX} value={motivo} onChange={(e) => { setMotivo(e.target.value); setErro(""); }}
            placeholder={conta ? "Ex: o defeito era do serviço anterior" : "Ex: equipamento sofreu queda de energia"} data-campo-motivo />
        </FormField>
        <Erro texto={erro} data-erro-decisao="" />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" variant={conta ? "danger" : "primary"} loading={salvando} onClick={salvar} data-confirmar-decisao>{conta ? "Marcar que conta" : "Marcar que não conta"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Reclamacao({ item, colaboradores, aoFechar, aoSalvar }: PropsDialogo & { item: PenalidadeNaLista | null; colaboradores: { id: string; nome: string }[] }) {
  const [form, setForm] = useState({
    tecnicoId: item?.tecnico.id ?? "", data: item ? chaveDiaBR(item.dataFato) : chaveHojeBR(),
    descricao: item?.descricao ?? "", osNumero: item?.ordemServico?.numero ?? "",
  });
  const set = (campo: keyof typeof form, valor: string) => { setForm((f) => ({ ...f, [campo]: valor })); setErro(""); };
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(""); setSalvando(true);
    try {
      const r = await fetch(item ? `/api/desempenho/penalidades/${item.id}` : "/api/desempenho/penalidades", {
        method: item ? "PUT" : "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...form, osNumero: form.osNumero || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível salvar a reclamação."); return; }
      aoSalvar();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto onFechar={aoFechar} titulo={item ? "Editar reclamação" : "Registrar reclamação"} tamanho="lg">
      <div className="space-y-4" data-modal-reclamacao>
        <p className="text-sm text-ink-muted">Reclamação recebida por telefone ou WhatsApp. Entra em “A revisar”: registrar não é penalizar.</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
          <FormField label="Colaborador" required>
            <Select aria-label="Colaborador" value={form.tecnicoId} onChange={(e) => set("tecnicoId", e.target.value)} data-campo-colaborador>
              <option value="">Escolha…</option>
              {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </FormField>
          <FormField label="Data" required>
            <InputData aria-label="Data da reclamação" value={form.data} onChange={(iso) => set("data", iso)} />
          </FormField>
        </div>
        <FormField label="O que o cliente reclamou" required>
          <Textarea aria-label="O que o cliente reclamou" rows={3} maxLength={DESCRICAO_MAX} value={form.descricao} onChange={(e) => set("descricao", e.target.value)}
            placeholder="Ex: cliente ligou dizendo que o aparelho voltou a pingar" data-campo-descricao />
        </FormField>
        <FormField label="Número da OS" hint="Opcional. A OS do serviço reclamado.">
          <Input aria-label="Número da OS" value={form.osNumero} onChange={(e) => set("osNumero", e.target.value)} placeholder="Ex: OS-00123" data-campo-os />
        </FormField>
        <Erro texto={erro} data-erro-reclamacao="" />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar} data-salvar-reclamacao>{item ? "Salvar" : "Registrar"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Excluir({ item, aoFechar, aoSalvar }: PropsDialogo & { item: PenalidadeNaLista }) {
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  async function excluir() {
    setErro(""); setSalvando(true);
    try {
      const r = await fetch(`/api/desempenho/penalidades/${item.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível excluir a reclamação."); return; }
      aoSalvar();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }
  return (
    <Modal aberto onFechar={aoFechar} titulo="Excluir reclamação" tamanho="sm">
      <div className="space-y-4" data-modal-excluir-reclamacao>
        <p className="text-sm text-ink">A reclamação de <span className="font-medium">{item.tecnico.nome}</span> em {formatarData(item.dataFato)} sai da lista e do escore.</p>
        <Erro texto={erro} />
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" variant="danger" loading={salvando} onClick={excluir} data-confirmar-exclusao>Excluir</Button>
        </div>
      </div>
    </Modal>
  );
}
