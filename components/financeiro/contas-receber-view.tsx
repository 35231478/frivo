"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { cn, formatarMoeda, formatarData, formatarCpfCnpj, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { ContaReceberAcoes } from "@/components/financeiro/conta-receber-acoes";
import { ContaReceberDetalhes } from "@/components/financeiro/conta-receber-detalhes";
import { origemComLink } from "@/lib/financeiro/conta-receber-gestao";
import { SincronizarBoletos } from "@/components/financeiro/sincronizar-boletos";
import { CategoriaBadge } from "@/components/financeiro/categoria-badge";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { Paginacao } from "@/components/listagem/listagem-ui";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import {
  Receipt, AlertTriangle, CalendarClock, CheckCircle2, Search, SlidersHorizontal,
  Plus, Download, Barcode, Loader2, Sigma,
} from "lucide-react";
import { BarraPeriodo, CardResumo, GradeCards, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";
import { recebidaEmParte, saldoDaConta } from "@/lib/financeiro/parcelas";

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
  /** Gestão (CR robusto) */
  observacao?: string | null; centroCustoId?: string | null; contaBancariaId?: string | null;
  medicaoId?: string | null; orcamentoId?: string | null; contratoId?: string | null;
  medicaoNumero?: string | null; orcamentoCodigo?: string | null; contratoNumero?: string | null; medicaoAvulsa?: boolean | null;
  notas?: { status: string }[];
  /** Baixa parcial: quanto já entrou (o saldo é valor − valorRecebido) */
  valorRecebido?: number;
  /** Parcela: o lançamento de onde saiu e "n/N" */
  lancamentoId?: string | null; lancamentoNumero?: string | null; parcelaNumero?: number | null; parcelaTotal?: number | null;
}
interface Opcao { id: string; nome: string }

/** Cards do período (lib/listas/filtros: CARDS_PERIODO_RECEBER): quantidade + R$ */
export type ResumoReceber = Record<CardKey, { v: number; q: number }>;

export interface FiltrosReceber {
  q: string; card: string; clienteId: string; categoria: string; forma: string; banco: string;
  valorMin: string; valorMax: string; vencDe: string; vencAte: string;
  /** chips de status visual, separados por vírgula */
  status: string;
  /** ?conta=<id>: abre a conta direto na gaveta de detalhes (links do orçamento/medição/OS) */
  conta?: string;
}

type CardKey = "VENCIDO" | "VENCE_HOJE" | "A_VENCER" | "RECEBIDO" | "TOTAL";

/**
 * Contas a Receber no padrão da casa: período (‹ mês ›, personalizado ou todo o período — pelo
 * VENCIMENTO) + cards do período clicáveis como filtro, e a lista em "cara de planilha" no desktop
 * (cartões no celular). Busca, filtros, período e paginação rodam no SERVIDOR (a URL é a fonte da
 * verdade); a exportação CSV exporta o FILTRO (com o período), não a página.
 */
export function ContasReceberView({
  contas, clientes, categorias, interAtivo, resumo, total, totalFiltrado, abertoFiltrado, pagina, porPagina, filtros, periodo,
}: {
  contas: ContaView[]; clientes: Opcao[]; categorias: { id: string; nome: string; cor: string; ativo: boolean }[];
  interAtivo: boolean; resumo: ResumoReceber; total: number; totalFiltrado: number;
  /** O que falta receber no filtro (abertas, pelo saldo) */
  abertoFiltrado?: number;
  pagina: number; porPagina: number; filtros: FiltrosReceber; periodo: PeriodoTela;
}) {
  const { pode } = usePermissoes();
  const podeCobrar = pode("financeiro", "contasReceber");
  const { busca, setBusca, navegar, pendente } = useListagemUrl({
    chave: "contas-receber", qAtual: filtros.q, paramBusca: "q", lembrarFiltros: false,
  });
  const [painel, setPainel] = useState(
    !!(filtros.clienteId || filtros.categoria || filtros.forma || filtros.banco || filtros.valorMin || filtros.valorMax),
  );
  // Painel: edita local e "Aplicar" manda tudo para a URL de uma vez (o vencimento é o período, lá em cima)
  const [f, setF] = useState({
    clienteId: filtros.clienteId, forma: filtros.forma,
    banco: filtros.banco, categoria: filtros.categoria, valorMin: filtros.valorMin, valorMax: filtros.valorMax,
  });
  const [detalheId, setDetalheId] = useState<string | null>(filtros.conta || null);
  const fecharDetalhe = () => { setDetalheId(null); if (filtros.conta) navegar({ conta: null }); };
  const acoes = (c: ContaView) => (
    <ContaReceberAcoes conta={{ ...c, interAtivo }} categorias={categorias} clientes={clientes} onDetalhes={() => setDetalheId(c.id)} />
  );
  const statusChips = useMemo(() => new Set(filtros.status.split(",").filter(Boolean)), [filtros.status]);
  const card = filtros.card as CardKey | "";

  const comStatus = useMemo(() => contas.map((c) => ({ c, sv: statusVisualReceber(c.status, c.dataVencimento) })), [contas]);
  const filtrosAtivos = Object.values(f).filter(Boolean).length + (statusChips.size ? 1 : 0);

  function aplicar() {
    navegar({
      clienteId: f.clienteId || null, forma: f.forma || null,
      banco: f.banco || null, categoria: f.categoria || null, valorMin: f.valorMin || null, valorMax: f.valorMax || null,
    });
    setPainel(false);
  }
  function limpar() {
    setF({ clienteId: "", forma: "", banco: "", categoria: "", valorMin: "", valorMax: "" });
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

  // Nada no período: oferece todo o período (busca de uma conta antiga, link de outra tela)
  const Vazio = () => (
    <div className="flex flex-col items-center gap-2 py-10 text-center" data-lista-vazia>
      <p className="text-sm font-medium text-ink">{periodo.tipo === "todos" ? "Nenhuma cobrança encontrada" : `Nenhuma cobrança em ${periodo.tipo === "mes" ? periodo.rotulo.toLowerCase() : "o período"}`}</p>
      {periodo.tipo !== "todos" && (
        <button type="button" onClick={() => navegar({ mes: null, de: null, ate: null, periodo: "todos" })} className="text-sm text-primary-600 hover:underline" data-ver-todo-periodo>Ver todo o período</button>
      )}
    </div>
  );

  const inputCls = "bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  const CARDS: { key: CardKey; rotulo: string; icone: ComponentType<{ className?: string }>; cor: string; dica?: string }[] = [
    { key: "VENCIDO", rotulo: "Vencidos", icone: AlertTriangle, cor: "text-atrasado", dica: "Pelo que falta receber: a parte já recebida não entra." },
    { key: "VENCE_HOJE", rotulo: "Vencem hoje", icone: CalendarClock, cor: "text-atencao-texto" },
    { key: "A_VENCER", rotulo: "A vencer", icone: Receipt, cor: "text-primary-600", dica: "Inclui as previsões (contratos e orçamentos aprovados). Pelo que falta receber." },
    { key: "RECEBIDO", rotulo: "Recebidos", icone: CheckCircle2, cor: "text-success-600" },
    { key: "TOTAL", rotulo: "Total do período", icone: Sigma, cor: "text-ink", dica: "Todas as cobranças do período, menos as canceladas." },
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

      {/* Período (pelo vencimento) + cards do período, clicáveis como filtro — padrão da casa */}
      <BarraPeriodo periodo={periodo} navegar={navegar} permitirTodos dica="Pela data de vencimento." />
      <GradeCards colunas={5}>
        {CARDS.map((c) => (
          <CardResumo key={c.key} id={c.key} rotulo={c.rotulo} icone={c.icone} cor={c.cor} dica={c.dica}
            v={resumo[c.key].v} q={resumo[c.key].q} unidade={["cobrança", "cobranças"]}
            ativo={card === c.key} onClick={() => navegar({ card: card === c.key ? null : c.key })} />
        ))}
      </GradeCards>

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
                {(["PREVISTO", "A_VENCER", "VENCE_HOJE", "VENCIDO", "PARCIAL", "PAGO", "CANCELADO"] as const).map((s) => (
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

        {/* Celular: um cartão por conta (toque abre os detalhes; ações no ⋮) */}
        <ul className="md:hidden divide-y divide-surface-border" data-cartoes-receber>
          {comStatus.length === 0 ? (
            <li><Vazio /></li>
          ) : comStatus.map(({ c, sv }) => {
            const origem = origemComLink(c);
            return (
              <li key={c.id} className={cn("flex items-start gap-3 px-4 py-3", sv.linhaVermelha && "bg-atrasado-claro")} data-cartao-conta={c.id}>
                <button type="button" onClick={() => setDetalheId(c.id)} className="flex-1 min-w-0 text-left" aria-label={`Ver detalhes de ${c.numero}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-ink truncate">{c.clienteNome}</p>
                    <p className="font-bold text-success-700 shrink-0">{formatarMoeda(c.valor)}</p>
                  </div>
                  <p className="text-xs text-ink-muted truncate">{c.numero} · {c.descricao}</p>
                  {recebidaEmParte(c) && (
                    <p className="text-xs text-ink-muted mt-0.5" data-parcial-cartao>
                      Recebido {formatarMoeda(c.valorRecebido ?? 0)} · <strong className="text-ink">falta {formatarMoeda(saldoDaConta(c))}</strong>
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full", sv.classe)}>{sv.label}</span>
                    {recebidaEmParte(c) && <SeloParcial />}
                    <span className="text-xs text-ink-subtle">{c.dataVencimento ? `Vence ${formatarData(c.dataVencimento)}` : "Sem vencimento"}</span>
                    {origem && <span className="text-xs text-acento">{origem.rotulo}</span>}
                    {c.boletoStatus === "EMITIDO" && <Barcode className="w-3.5 h-3.5 text-ok-texto" aria-label="Boleto emitido" />}
                  </div>
                </button>
                <div className="shrink-0 -mr-1">{acoes(c)}</div>
              </li>
            );
          })}
        </ul>

        {/* Desktop: "cara de planilha" (lib/planilha — o mesmo estilo do documento do orçamento) */}
        <div className="hidden md:block overflow-x-auto" data-tabela-receber>
          <table className={cn(PLANILHA.tabela, "table-fixed")} data-tabela-planilha>
            <thead>
              <tr className={PLANILHA.cabecalho}>
                <th scope="col" className={cn(PLANILHA.th, "text-left w-[5.75rem]")}>Vencimento</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left hidden lg:table-cell w-[8.5rem]")}>Nº</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left w-[17%]")}>Cliente</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left hidden lg:table-cell")}>Descrição</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left hidden xl:table-cell w-[10rem]")}>Categoria</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left w-[8rem]")}>Situação</th>
                <th scope="col" className={cn(PLANILHA.th, "text-right w-[7.5rem]")}>Valor (R$)</th>
                <th scope="col" className={cn(PLANILHA.th, "text-right hidden lg:table-cell w-[7.5rem]")}>Em aberto (R$)</th>
                <th scope="col" className={cn(PLANILHA.th, "w-10")}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {comStatus.length === 0 ? (
                <tr><td colSpan={9}><Vazio /></td></tr>
              ) : comStatus.map(({ c, sv }) => {
                const origem = origemComLink(c);
                return (
                  <tr key={c.id} data-linha-conta={c.id}
                    className={cn(PLANILHA.linha, "hover:bg-primary-50/40", sv.linhaVermelha && "even:bg-atrasado-claro bg-atrasado-claro hover:bg-atrasado-claro/70")}>
                    <td className={cn(PLANILHA.td, "align-middle tabular-nums whitespace-nowrap text-ink-muted")}>{c.dataVencimento ? formatarData(c.dataVencimento) : "—"}</td>
                    <td className={cn(PLANILHA.td, "align-middle hidden lg:table-cell truncate font-mono text-[11px] text-ink-subtle")} title={c.numero} data-numero-conta>{c.numero}</td>
                    <td className={cn(PLANILHA.td, "align-middle")}>
                      <p className="font-medium text-ink truncate" title={c.clienteCnpj ? `${c.clienteNome} · ${formatarCpfCnpj(c.clienteCnpj)}` : c.clienteNome}>{c.clienteNome}</p>
                    </td>
                    <td className={cn(PLANILHA.td, "align-middle hidden lg:table-cell")}>
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <button type="button" onClick={() => setDetalheId(c.id)} title={c.descricao} className="min-w-0 text-left text-ink hover:text-primary-600 truncate" data-abrir-detalhes={c.id}>{c.descricao}</button>
                        {origem && <Link href={origem.href} title={origem.rotulo} className="shrink-0 max-w-[45%] truncate text-[11px] text-acento hover:underline" data-origem-conta>{origem.rotulo}</Link>}
                      </div>
                    </td>
                    <td className={cn(PLANILHA.td, "align-middle hidden xl:table-cell")}><CategoriaBadge conta={c} categorias={categorias} linhaUnica /></td>
                    <td className={cn(PLANILHA.td, "align-middle")}>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full", sv.classe)} data-situacao>
                          {sv.linhaVermelha && <AlertTriangle className="w-3 h-3" />}{sv.label}
                        </span>
                        {recebidaEmParte(c) && <SeloParcial />}
                        {c.boletoStatus === "EMITIDO" && <Barcode className="w-3.5 h-3.5 text-ok-texto" aria-label="Boleto emitido" />}
                      </span>
                    </td>
                    <td className={cn(PLANILHA.td, PLANILHA.numero, "align-middle font-semibold text-ink")} data-valor>{valorSemMoeda(c.valor)}</td>
                    {/* O que falta: igual ao valor sem baixa; menor na baixa parcial; 0 na recebida/cancelada */}
                    <td className={cn(PLANILHA.td, PLANILHA.numero, "align-middle hidden lg:table-cell", recebidaEmParte(c) ? "font-semibold text-atencao-texto" : "text-ink-muted")} data-em-aberto>
                      {c.status === "CANCELADO" ? "—" : valorSemMoeda(saldoDaConta(c))}
                    </td>
                    <td className={cn(PLANILHA.td, "align-middle text-right py-0.5")}>{acoes(c)}</td>
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
            {abertoFiltrado != null && <> · em aberto: <strong className="text-ink" data-aberto-filtrado>{formatarMoeda(abertoFiltrado)}</strong></>}
          </p>
        </div>
      </div>
      <ContaReceberDetalhes id={detalheId} onFechar={fecharDetalhe} onAbrirConta={setDetalheId} />
    </div>
  );
}

const LABEL_CHAVE: Record<string, string> = { PREVISTO: "Previsto", A_VENCER: "A vencer", VENCE_HOJE: "Vence hoje", VENCIDO: "Vencido", PARCIAL: "Recebido em parte", PAGO: "Pago", CANCELADO: "Cancelado" };

/** Baixa parcial: entrou uma parte e ainda falta (a situação continua a do vencimento) */
function SeloParcial() {
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-atencao-claro text-atencao-texto" data-selo-parcial>Parcial</span>;
}

function FiltroCampo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[11px] font-semibold text-ink-muted">{label}</label><div className="mt-1">{children}</div></div>;
}
