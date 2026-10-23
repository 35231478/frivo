"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn, formatarMoeda, formatarData, formatarCpfCnpj, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { AvatarCliente } from "@/components/ui/avatar-cliente";
import { ContaReceberAcoes } from "@/components/financeiro/conta-receber-acoes";
import { SincronizarBoletos } from "@/components/financeiro/sincronizar-boletos";
import { CategoriaBadge } from "@/components/financeiro/categoria-badge";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { Paginacao } from "@/components/listagem/listagem-ui";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import {
  Receipt, AlertTriangle, CalendarClock, CheckCircle2, Search, SlidersHorizontal,
  Plus, Download, X, Barcode, Loader2,
} from "lucide-react";

export interface ContaView {
  id: string; numero: string; descricao: string; valor: number;
  /** Categoria ligada (por id) e o texto antigo (só exibido quando não há vínculo) */
  categoriaId: string | null; categoria: string | null;
  dataVencimento: string | null; dataRecebimento: string | null; status: string; banco: string | null;
  clienteId: string; clienteNome: string; clienteCnpj: string | null; clienteLogo: string | null;
  formaPagamento: string | null;
  whatsapp: string | null; email: string | null; notificacaoEnviadaEm: string | null;
  boletoStatus: string | null; boletoEmitidoEm: string | null; boletoVencimento: string | null;
  boletoLinhaDigitavel: string | null; boletoCodigoBarras: string | null;
}
interface Opcao { id: string; nome: string }

export interface ResumoReceber {
  aReceber: { v: number; q: number }; vencido: { v: number; q: number };
  hoje: { v: number; q: number }; recebido: { v: number; q: number };
}

export interface FiltrosReceber {
  q: string; card: string; clienteId: string; categoria: string; forma: string; banco: string;
  valorMin: string; valorMax: string; vencDe: string; vencAte: string;
  /** chips de status visual, separados por vírgula */
  status: string;
}

type CardKey = "A_RECEBER" | "VENCIDO" | "VENCE_HOJE" | "RECEBIDO";

/**
 * UX-4 (E4): busca, filtros e paginação rodam no SERVIDOR (a URL é a fonte da verdade) —
 * acabou o corte fixo de 500 em que contas "sumiam" da tela. Os cartões de resumo vêm de
 * agregados sobre o conjunto COMPLETO; a exportação CSV exporta o FILTRO, não a página.
 */
export function ContasReceberView({
  contas, clientes, categorias, interAtivo, resumo, total, totalFiltrado, pagina, porPagina, filtros,
}: {
  contas: ContaView[]; clientes: Opcao[]; categorias: { id: string; nome: string; cor: string; ativo: boolean }[];
  interAtivo: boolean; resumo: ResumoReceber; total: number; totalFiltrado: number;
  pagina: number; porPagina: number; filtros: FiltrosReceber;
}) {
  const { pode } = usePermissoes();
  const podeCobrar = pode("financeiro", "contasReceber");
  const { busca, setBusca, navegar, pendente } = useListagemUrl({
    chave: "contas-receber", qAtual: filtros.q, paramBusca: "q", lembrarFiltros: false,
  });
  const [painel, setPainel] = useState(
    !!(filtros.clienteId || filtros.categoria || filtros.forma || filtros.banco || filtros.valorMin || filtros.valorMax || filtros.vencDe || filtros.vencAte),
  );
  // Painel: edita local e "Aplicar" manda tudo para a URL de uma vez
  const [f, setF] = useState({
    vencDe: filtros.vencDe, vencAte: filtros.vencAte, clienteId: filtros.clienteId, forma: filtros.forma,
    banco: filtros.banco, categoria: filtros.categoria, valorMin: filtros.valorMin, valorMax: filtros.valorMax,
  });
  const statusChips = useMemo(() => new Set(filtros.status.split(",").filter(Boolean)), [filtros.status]);
  const card = filtros.card as CardKey | "";

  const comStatus = useMemo(() => contas.map((c) => ({ c, sv: statusVisualReceber(c.status, c.dataVencimento) })), [contas]);
  const filtrosAtivos = Object.values(f).filter(Boolean).length + (statusChips.size ? 1 : 0);

  function aplicar() {
    navegar({
      vencDe: f.vencDe || null, vencAte: f.vencAte || null, clienteId: f.clienteId || null, forma: f.forma || null,
      banco: f.banco || null, categoria: f.categoria || null, valorMin: f.valorMin || null, valorMax: f.valorMax || null,
    });
    setPainel(false);
  }
  function limpar() {
    setF({ vencDe: "", vencAte: "", clienteId: "", forma: "", banco: "", categoria: "", valorMin: "", valorMax: "" });
    navegar({ vencDe: null, vencAte: null, clienteId: null, forma: null, banco: null, categoria: null, valorMin: null, valorMax: null, status: null });
  }
  function toggleStatus(chave: string) {
    const s = new Set(statusChips);
    s.has(chave) ? s.delete(chave) : s.add(chave);
    navegar({ status: [...s].join(",") || null });
  }
  /** Exporta o FILTRO inteiro (o servidor monta o CSV com o mesmo where da tela). */
  function exportar() {
    window.location.href = `/api/contas-receber/exportar${window.location.search}`;
  }

  const inputCls = "bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  const CARDS: { key: CardKey; label: string; icone: any; cor: string; bgSel: string; borda: string; v: number; q: number }[] = [
    { key: "A_RECEBER", label: "A Receber", icone: Receipt, cor: "text-primary-600", bgSel: "bg-primary-50", borda: "border-b-primary-500", v: resumo.aReceber.v, q: resumo.aReceber.q },
    { key: "VENCIDO", label: "Vencido", icone: AlertTriangle, cor: "text-red-600", bgSel: "bg-red-50", borda: "border-b-red-500", v: resumo.vencido.v, q: resumo.vencido.q },
    { key: "VENCE_HOJE", label: "Vence Hoje", icone: CalendarClock, cor: "text-amber-600", bgSel: "bg-amber-50", borda: "border-b-amber-500", v: resumo.hoje.v, q: resumo.hoje.q },
    { key: "RECEBIDO", label: "Recebido (mês)", icone: CheckCircle2, cor: "text-success-600", bgSel: "bg-success-50", borda: "border-b-success-500", v: resumo.recebido.v, q: resumo.recebido.q },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><Receipt className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Contas a Receber</h1>
        </div>
        <div className="flex items-center gap-2">
          {interAtivo && <SincronizarBoletos />}
          <button onClick={exportar} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-surface-border text-ink-muted hover:bg-surface-alt transition-colors"><Download className="w-4 h-4" /> Exportar</button>
          {/* UX-8 (G14): o botão segue a MESMA permissão do POST de criação — nunca leva a um 403 */}
          {podeCobrar && <Link href="/financeiro/contas-receber/nova" data-nova-cobranca className="inline-flex items-center gap-1.5 bg-success-500 hover:bg-success-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm"><Plus className="w-4 h-4" /> Nova Cobrança</Link>}
        </div>
      </div>

      {/* Cards de resumo (clicáveis) — agregados sobre TODAS as contas da empresa */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {CARDS.map((c) => {
          const sel = card === c.key;
          return (
            <button key={c.key} type="button" data-card={c.key} aria-pressed={sel}
              onClick={() => navegar({ card: sel ? null : c.key })}
              className={cn(
                "text-left rounded-xl border border-surface-border border-b-2 bg-white p-4 transition-all hover:shadow-card",
                c.borda, sel ? `${c.bgSel} ring-2 ring-offset-1 ring-primary-200` : "hover:border-primary-200",
              )}>
              <div className="flex items-start justify-between">
                <c.icone className={cn("w-5 h-5", c.cor)} />
                {sel && <X className="w-3.5 h-3.5 text-ink-subtle" />}
              </div>
              <p className="text-xs text-ink-muted mt-2">{c.label}</p>
              <p className="text-xl font-bold text-ink mt-0.5">{formatarMoeda(c.v)}</p>
              <p className="text-[11px] text-ink-subtle mt-0.5">{c.q} cobrança{c.q === 1 ? "" : "s"}</p>
            </button>
          );
        })}
      </div>

      {/* Busca + filtros */}
      <div className="card overflow-hidden">
        <div className="p-3 border-b border-surface-border flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            {pendente
              ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle animate-spin pointer-events-none" />
              : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />}
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por cliente, descrição ou número…" className={cn(inputCls, "w-full pl-9")} />
          </div>
          <button onClick={() => setPainel((v) => !v)} className={cn("inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors", painel || filtrosAtivos ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-ink-muted hover:bg-surface-alt")}>
            <SlidersHorizontal className="w-4 h-4" /> Filtros
            {filtrosAtivos > 0 && <span className="text-[10px] font-bold bg-primary-500 text-white rounded-full w-4 h-4 flex items-center justify-center">{filtrosAtivos}</span>}
          </button>
        </div>

        {painel && (
          <div className="p-4 border-b border-surface-border bg-surface-alt/40 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <FiltroCampo label="Vencimento — de"><input type="date" value={f.vencDe} onChange={(e) => setF({ ...f, vencDe: e.target.value })} className={inputCls} /></FiltroCampo>
              <FiltroCampo label="Vencimento — até"><input type="date" value={f.vencAte} onChange={(e) => setF({ ...f, vencAte: e.target.value })} className={inputCls} /></FiltroCampo>
              <FiltroCampo label="Cliente">
                <select value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value })} className={inputCls}>
                  <option value="">Todos</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </FiltroCampo>
              <FiltroCampo label="Categoria">
                <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} className={inputCls}>
                  <option value="">Todas</option>
                  {/* Filtro: inclui as inativas (contas antigas continuam filtráveis) */}
                  {categorias.map((c) => <option key={c.id} value={c.id}>{c.ativo ? c.nome : `${c.nome} (inativa)`}</option>)}
                </select>
              </FiltroCampo>
              <FiltroCampo label="Forma de pagamento">
                <select value={f.forma} onChange={(e) => setF({ ...f, forma: e.target.value })} className={inputCls}>
                  <option value="">Todas</option>
                  {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </FiltroCampo>
              <FiltroCampo label="Banco"><input value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} className={inputCls} placeholder="Banco" /></FiltroCampo>
              <FiltroCampo label="Valor de"><input type="number" value={f.valorMin} onChange={(e) => setF({ ...f, valorMin: e.target.value })} className={inputCls} placeholder="0,00" /></FiltroCampo>
              <FiltroCampo label="Valor até"><input type="number" value={f.valorMax} onChange={(e) => setF({ ...f, valorMax: e.target.value })} className={inputCls} placeholder="0,00" /></FiltroCampo>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">Status</p>
              <div className="flex flex-wrap gap-1.5">
                {(["PREVISTO", "A_VENCER", "VENCE_HOJE", "VENCIDO", "PAGO", "CANCELADO"] as const).map((s) => (
                  <button key={s} type="button" data-chip-status={s} onClick={() => toggleStatus(s)}
                    className={cn("text-xs px-2.5 py-1 rounded-full border transition-colors", statusChips.has(s) ? "bg-primary-500 border-primary-500 text-white" : "bg-white border-surface-border text-ink-muted hover:border-primary-300")}>
                    {LABEL_CHAVE[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={limpar} className="text-sm text-ink-muted hover:text-ink px-3 py-1.5">Limpar</button>
              <button onClick={aplicar} className="text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 px-4 py-1.5 rounded-lg">Aplicar</button>
            </div>
          </div>
        )}

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Descrição</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Categoria</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Vencimento</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Valor</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {comStatus.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-ink-subtle py-12">Nenhuma cobrança encontrada</td></tr>
              ) : comStatus.map(({ c, sv }) => {
                return (
                  <tr key={c.id} className={cn("border-b border-surface-border transition-colors", sv.linhaVermelha ? "bg-red-50 hover:bg-red-100/50" : "hover:bg-surface-alt/60")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <AvatarCliente nome={c.clienteNome} logoUrl={c.clienteLogo} size={32} />
                        <div className="min-w-0">
                          <p className="font-medium text-ink truncate max-w-[180px]">{c.clienteNome}</p>
                          {c.clienteCnpj && <p className="text-xs text-ink-subtle">{formatarCpfCnpj(c.clienteCnpj)}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell truncate max-w-[200px]">{c.descricao}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <CategoriaBadge conta={c} categorias={categorias} />
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{c.dataVencimento ? formatarData(c.dataVencimento) : "—"}</td>
                    <td className="px-4 py-3 text-right font-bold text-success-700">{formatarMoeda(c.valor)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full", sv.classe)}>
                          {sv.linhaVermelha && <AlertTriangle className="w-3 h-3" />}{sv.label}
                        </span>
                        {c.boletoStatus === "EMITIDO" && <Barcode className="w-4 h-4 text-emerald-600" aria-label="Boleto emitido" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ContaReceberAcoes conta={{
                        id: c.id, numero: c.numero, descricao: c.descricao, categoriaId: c.categoriaId, categoria: c.categoria, valor: c.valor,
                        dataVencimento: c.dataVencimento, status: c.status, banco: c.banco,
                        clienteNome: c.clienteNome, whatsapp: c.whatsapp, email: c.email, notificacaoEnviadaEm: c.notificacaoEnviadaEm,
                        interAtivo, boletoStatus: c.boletoStatus, boletoEmitidoEm: c.boletoEmitidoEm, boletoVencimento: c.boletoVencimento,
                        boletoLinhaDigitavel: c.boletoLinhaDigitavel, boletoCodigoBarras: c.boletoCodigoBarras,
                      }} categorias={categorias} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-surface-border bg-surface-alt/40 space-y-2">
          <Paginacao total={total} pagina={pagina} porPagina={porPagina} onNavegar={navegar} rotulo="cobranças" />
          <p className="text-sm text-ink-muted" data-total-filtrado>
            Total do filtro: <strong className="text-ink">{formatarMoeda(totalFiltrado)}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}

const LABEL_CHAVE: Record<string, string> = { PREVISTO: "Previsto", A_VENCER: "A vencer", VENCE_HOJE: "Vence hoje", VENCIDO: "Vencido", PAGO: "Pago", CANCELADO: "Cancelado" };

function FiltroCampo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[11px] font-semibold text-ink-muted">{label}</label><div className="mt-1">{children}</div></div>;
}
