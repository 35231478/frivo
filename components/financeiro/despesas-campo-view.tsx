"use client";

import { useCallback, useEffect, useState } from "react";
import { useFiltroUrl, useListagemUrl } from "@/components/listagem/use-listagem-url";
import Link from "next/link";
import { Check, Image as ImageIcon, Loader2, Settings2, X } from "lucide-react";
import { cn, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InputData } from "@/components/ui/input-data";
import { Lightbox } from "@/components/ui/lightbox";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/avisos";
import { atualizarSino } from "@/lib/ui/sino";
import { chaveHojeBR } from "@/lib/fuso";
import {
  CATEGORIAS_DESPESA, DIAS_VENCIMENTO_REEMBOLSO, PAGAMENTO_ESCRITORIO, resumoDespesas,
  type CategoriaDespesa, type MapaCategorias, type StatusDespesa,
} from "@/lib/tecnico/despesas";
import type { DespesaEscritorio } from "@/lib/execucao/despesas";

type Filtro = StatusDespesa | "TODAS";
const FILTROS: { id: Filtro; nome: string }[] = [
  { id: "PENDENTE", nome: "A aprovar" }, { id: "APROVADA", nome: "Aprovadas" }, { id: "RECUSADA", nome: "Recusadas" }, { id: "TODAS", nome: "Todas" },
];
const TOM: Record<StatusDespesa, TomStatus> = { PENDENTE: "atencao", APROVADA: "ok", RECUSADA: "atrasado" };
const ROTULO: Record<StatusDespesa, string> = { PENDENTE: "A aprovar", APROVADA: "Aprovada", RECUSADA: "Recusada" };
const dataBR = (dia: string) => dia.split("-").reverse().join("/");
interface Categorias { mapa: MapaCategorias; ativas: { id: string; nome: string }[]; efetivas: Record<CategoriaDespesa, string | null> }

/**
 * Financeiro › Despesas de campo: o que o técnico lançou pelo app, com a foto do cupom. Aprovar a paga do bolso gera a
 * conta a pagar de reembolso ao colaborador; a paga pela empresa fica só como custo da OS. Recusar pede o motivo.
 */
export function DespesasCampoView({ podeDecidir }: { podeDecidir: boolean }) {
  // A situação vai para a URL (`?situacao=`) e é lembrada ao voltar (o mesmo das outras listas); padrão: a aprovar
  const { navegar } = useListagemUrl({ chave: "despesas-campo", qAtual: "" });
  const [situacao, setSituacao] = useFiltroUrl("situacao", navegar, { vazio: "PENDENTE" });
  const filtro: Filtro = FILTROS.some((f) => f.id === situacao) ? (situacao as Filtro) : "PENDENTE";
  const setFiltro = (f: Filtro) => setSituacao(f);
  const [lista, setLista] = useState<DespesaEscritorio[] | null>(null);
  const [cats, setCats] = useState<Categorias | null>(null);
  const [cupom, setCupom] = useState<DespesaEscritorio | null>(null);
  const [aprovando, setAprovando] = useState<DespesaEscritorio | null>(null);
  const [recusando, setRecusando] = useState<DespesaEscritorio | null>(null);
  const [mapaAberto, setMapaAberto] = useState(false);

  const carregar = useCallback(async () => {
    setLista(null);
    const r = await fetch(`/api/despesas-campo?status=${filtro}`, { cache: "no-store" });
    setLista(r.ok ? (await r.json()).despesas : []);
  }, [filtro]);
  const carregarCats = useCallback(async () => {
    const r = await fetch("/api/despesas-campo/categorias", { cache: "no-store" });
    if (r.ok) setCats(await r.json());
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { void carregarCats(); }, [carregarCats]);
  const decidiu = () => { void carregar(); atualizarSino(); };

  const resumo = resumoDespesas(lista ?? []);
  return (
    <div data-tela="despesas-campo">
      <PageHeader title="Despesas de campo" backHref="/financeiro"
        dica="Despesas que os técnicos lançaram pelo app, com a foto do cupom. Aprovar a paga do bolso do colaborador gera a conta a pagar de reembolso; a paga pela empresa fica registrada como custo da OS."
        actions={podeDecidir && (
          <Button variant="secondary" onClick={() => setMapaAberto(true)} data-abrir-mapa>
            <Settings2 className="w-4 h-4" /> Categorias
          </Button>
        )} />

      <div className="flex flex-wrap items-center gap-2 mb-4" role="tablist" aria-label="Situação">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filtro === f.id} onClick={() => setFiltro(f.id)} data-filtro={f.id}
            className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold border transition-colors",
              filtro === f.id ? "bg-acento text-white border-acento" : "bg-white text-ink border-surface-border hover:bg-surface-page")}>
            {f.nome}
          </button>
        ))}
        {filtro === "PENDENTE" && lista && resumo.pendentes > 0 && (
          <span className="ml-auto text-sm text-ink-muted" data-resumo>
            {resumo.pendentes} a aprovar · {formatarMoeda(resumo.totalPendente)}
            {resumo.aReembolsar > 0 && <> · <span className="font-semibold text-ink">{formatarMoeda(resumo.aReembolsar)} de reembolso</span></>}
          </span>
        )}
      </div>

      {lista === null && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div>}
      {lista && !lista.length && (
        <p className="rounded-card bg-white border border-surface-border p-6 text-sm text-ink-muted text-center" data-vazio>
          {filtro === "PENDENTE" ? "Nenhuma despesa esperando aprovação." : "Nenhuma despesa."}
        </p>
      )}
      {lista && lista.length > 0 && (
        <ul className="space-y-2">
          {lista.map((d) => (
            <li key={d.id} className="rounded-card bg-white border border-surface-border p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-despesa-campo={d.id} data-status={d.status}>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{d.colaborador}</span>
                  <span className="text-ink-muted">·</span>
                  <span className="text-ink">{d.categoriaNome}</span>
                  <StatusPill tom={TOM[d.status]} tamanho="sm">{ROTULO[d.status]}</StatusPill>
                </div>
                <p className="text-sm text-ink-muted">
                  {dataBR(d.data)} · {PAGAMENTO_ESCRITORIO[d.pagamento]}
                  {d.os && <> · <Link href={`/ordens/${d.os.id}`} className="text-acento hover:underline" data-os-despesa>{d.os.numero}</Link></>}
                  {d.descricao && <> · {d.descricao}</>}
                </p>
                {d.status === "RECUSADA" && d.motivoRecusa && <p className="text-sm text-atrasado-texto" data-motivo>Motivo: {d.motivoRecusa}</p>}
                {d.status !== "PENDENTE" && d.decididoEm && (
                  <p className="text-xs text-ink-subtle">{d.status === "APROVADA" ? "Aprovada" : "Recusada"}{d.decididoPor ? ` por ${d.decididoPor}` : ""} em {formatarDataHora(d.decididoEm)}</p>
                )}
                {d.contaPagar && (
                  <Link href={`/financeiro/contas-pagar/${d.contaPagar.id}`} className="inline-block text-sm text-acento hover:underline" data-conta-reembolso>
                    Reembolso: {d.contaPagar.numero}
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="text-lg font-bold text-ink tabular-nums mr-auto sm:mr-2" data-valor>{formatarMoeda(d.valor)}</span>
                <Button variant="secondary" size="sm" onClick={() => setCupom(d)} aria-label="Ver cupom" data-ver-cupom>
                  <ImageIcon className="w-4 h-4" /> Cupom
                </Button>
                {podeDecidir && d.status === "PENDENTE" && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setRecusando(d)} data-recusar><X className="w-4 h-4" /> Recusar</Button>
                    <Button size="sm" onClick={() => setAprovando(d)} data-aprovar><Check className="w-4 h-4" /> Aprovar</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {cupom && (
        <Lightbox indice={0} onIndice={() => {}} onFechar={() => setCupom(null)}
          itens={[{
            src: `/api/despesas-campo/${cupom.id}/foto`, baixar: `/api/despesas-campo/${cupom.id}/foto`, nomeArquivo: `cupom-${cupom.data}.jpg`,
            titulo: `${cupom.categoriaNome} · ${formatarMoeda(cupom.valor)}`, detalhes: [cupom.colaborador, dataBR(cupom.data), cupom.os?.numero],
          }]} />
      )}
      {aprovando && <ModalAprovar d={aprovando} cats={cats} onFechar={() => setAprovando(null)} onFeito={() => { setAprovando(null); decidiu(); }} />}
      {recusando && <ModalRecusar d={recusando} onFechar={() => setRecusando(null)} onFeito={() => { setRecusando(null); decidiu(); }} />}
      {mapaAberto && cats && <ModalCategorias cats={cats} onFechar={() => setMapaAberto(false)} onSalvo={() => { setMapaAberto(false); void carregarCats(); }} />}
    </div>
  );
}

async function enviar(url: string, corpo: unknown, method = "POST"): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  if (r.ok) return null;
  return (await r.json().catch(() => null))?.erro ?? "Não foi possível salvar.";
}

function ModalAprovar({ d, cats, onFechar, onFeito }: { d: DespesaEscritorio; cats: Categorias | null; onFechar: () => void; onFeito: () => void }) {
  const doBolso = d.pagamento === "PROPRIO";
  const [vencimento, setVencimento] = useState(chaveHojeBR(DIAS_VENCIMENTO_REEMBOLSO));
  const [categoriaId, setCategoriaId] = useState(cats?.efetivas[d.categoria] ?? "");
  const [salvando, setSalvando] = useState(false);
  async function aprovar() {
    setSalvando(true);
    const erro = await enviar(`/api/despesas-campo/${d.id}/aprovar`, doBolso ? { vencimento, ...(categoriaId && { categoriaId }) } : {});
    setSalvando(false);
    if (erro) { toast(erro, "erro"); return; }
    toast(doBolso ? "Aprovada. A conta a pagar de reembolso foi criada." : "Aprovada.");
    onFeito();
  }
  return (
    <Modal aberto titulo="Aprovar despesa" onFechar={onFechar} tamanho="sm">
      <div className="space-y-4" data-modal-aprovar>
        <p className="text-sm text-ink">{d.colaborador} · {d.categoriaNome} · <span className="font-semibold">{formatarMoeda(d.valor)}</span></p>
        {doBolso ? (
          <>
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-ink">Vencimento do reembolso</span>
              <InputData value={vencimento} onChange={setVencimento} aria-label="Vencimento do reembolso" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-ink">Categoria financeira</span>
              <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} aria-label="Categoria financeira" data-categoria-financeira>
                <option value="">{d.categoriaNome} (nova)</option>
                {cats?.ativas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            </label>
          </>
        ) : (
          <p className="text-sm text-ink-muted" data-sem-reembolso>Paga pela empresa: fica registrada como custo{d.os ? ` da ${d.os.numero}` : ""}, sem conta a pagar.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button onClick={aprovar} loading={salvando} disabled={doBolso && !vencimento} data-confirmar-aprovar>Aprovar</Button>
        </div>
      </div>
    </Modal>
  );
}

function ModalRecusar({ d, onFechar, onFeito }: { d: DespesaEscritorio; onFechar: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ok = motivo.trim().length >= 3;
  async function recusar() {
    setSalvando(true);
    const erro = await enviar(`/api/despesas-campo/${d.id}/recusar`, { motivo: motivo.trim() });
    setSalvando(false);
    if (erro) { toast(erro, "erro"); return; }
    toast("Recusada. O colaborador vê o motivo no app.");
    onFeito();
  }
  return (
    <Modal aberto titulo="Recusar despesa" onFechar={onFechar} tamanho="sm">
      <div className="space-y-4" data-modal-recusar>
        <p className="text-sm text-ink">{d.colaborador} · {d.categoriaNome} · <span className="font-semibold">{formatarMoeda(d.valor)}</span></p>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">Motivo</span>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} rows={3} aria-label="Motivo da recusa" data-motivo-recusa-campo />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button variant="danger" onClick={recusar} loading={salvando} disabled={!ok} data-confirmar-recusar>Recusar</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Cada categoria da despesa → a categoria financeira da conta de reembolso (padrão: a de mesmo nome). */
function ModalCategorias({ cats, onFechar, onSalvo }: { cats: Categorias; onFechar: () => void; onSalvo: () => void }) {
  const [mapa, setMapa] = useState<Record<string, string>>(
    Object.fromEntries(CATEGORIAS_DESPESA.map((c) => [c.id, cats.efetivas[c.id] ?? ""])),
  );
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    const limpo = Object.fromEntries(Object.entries(mapa).filter(([, v]) => v));
    const erro = await enviar("/api/despesas-campo/categorias", { mapa: limpo }, "PUT");
    setSalvando(false);
    if (erro) { toast(erro, "erro"); return; }
    toast("Categorias salvas.");
    onSalvo();
  }
  return (
    <Modal aberto titulo="Categorias das despesas de campo" onFechar={onFechar}>
      <div className="space-y-3" data-modal-categorias>
        {CATEGORIAS_DESPESA.map((c) => (
          <label key={c.id} className="grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-3 sm:items-center">
            <span className="text-sm font-semibold text-ink">{c.nome}</span>
            <Select value={mapa[c.id]} onChange={(e) => setMapa((m) => ({ ...m, [c.id]: e.target.value }))} aria-label={`Categoria financeira de ${c.nome}`} data-mapa={c.id}>
              <option value="">{c.nome} (nova)</option>
              {cats.ativas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </Select>
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando} data-salvar-mapa>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}
