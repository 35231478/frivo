"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { cn, formatarMoeda, formatarData, formatarCpfCnpj } from "@/lib/utils";
import { statusVisualPagar, LABELS_STATUS_CONTA_PAGAR } from "@/lib/financeiro-status";
import { ContaPagarAcoes } from "@/components/financeiro/conta-pagar-acoes";
import { CategoriaBadge } from "@/components/financeiro/categoria-badge";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import {
  Upload, AlertTriangle, CalendarClock, CheckCircle2, Search, SlidersHorizontal, Plus, Barcode, Loader2, Sigma,
  FileText, ShoppingCart, Receipt,
} from "lucide-react";
import { BarraPeriodo, CardResumo, GradeCards, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { BarraFiltros, inputFiltro } from "@/components/listagem/barra-filtros";
import { CampoBusca, Paginacao } from "@/components/listagem/listagem-ui";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";

/** Uma conta a pagar já pronta para a tela (números em vez de Decimal, datas em texto) */
export interface ContaPagarView {
  id: string; numero: string; descricao: string;
  valorTotal: number; valorPago: number; saldoRestante: number;
  dataVencimento: string | null; status: string;
  /** Categoria ligada (por id) e o texto antigo (só exibido quando não há vínculo) */
  categoriaId: string | null; categoria: string | null;
  centroCusto: { id: string; nome: string; ativo: boolean } | null;
  /** fornecedorDaConta (o cadastro ligado; sem vínculo, o texto antigo) */
  fornecedor: { id: string | null; nome: string; documento: string | null; ativo: boolean; semCadastro: boolean };
  temBoleto: boolean;
  notaCompra: { id: string; numero: string } | null;
  pedidoCompra: { numero: string } | null;
}
interface Opcao { id: string; nome: string; ativo: boolean }

type CardKey = "VENCIDO" | "VENCE_HOJE" | "A_VENCER" | "PAGO" | "TOTAL";
/** Cards do período (lib/listas/filtros: CARDS_PERIODO_PAGAR): quantidade + R$ */
export type ResumoPagar = Record<CardKey, { v: number; q: number }>;

export interface FiltrosPagar {
  /** busca (fornecedor, descrição ou número) */
  fornecedor: string; card: string; status: string; fornecedorId: string; categoria: string; centro: string; origem: string;
}

/**
 * Contas a Pagar no padrão da casa (o mesmo de Contas a Receber): período pelo VENCIMENTO (‹ mês ›,
 * personalizado ou todo o período) + cards do período clicáveis como filtro, e a lista em "cara de
 * planilha" no desktop (cartões no celular). Busca, filtros, período e paginação rodam no SERVIDOR.
 */
export function ContasPagarView({
  contas, resumo, periodo, filtros, categorias, centros, fornecedores, total, pagina, porPagina, totalFiltrado, totalAberto, podeImportarNf,
}: {
  contas: ContaPagarView[]; resumo: ResumoPagar; periodo: PeriodoTela; filtros: FiltrosPagar;
  categorias: { id: string; nome: string; cor: string; ativo: boolean }[]; centros: Opcao[]; fornecedores: Opcao[];
  total: number; pagina: number; porPagina: number; totalFiltrado: number; totalAberto: number; podeImportarNf: boolean;
}) {
  const { busca, setBusca, navegar, pendente } = useListagemUrl({
    chave: "contas-pagar", qAtual: filtros.fornecedor, paramBusca: "fornecedor", lembrarFiltros: false,
  });
  const card = filtros.card as CardKey | "";
  const comStatus = useMemo(() => contas.map((c) => ({ c, sv: statusVisualPagar(c.status, c.dataVencimento) })), [contas]);

  /** Um select do painel: muda = vai para a URL na hora (o controle se destaca quando ativo) */
  const sel = (k: keyof FiltrosPagar) => ({
    value: filtros[k], onChange: (e: React.ChangeEvent<HTMLSelectElement>) => navegar({ [k]: e.target.value || null }),
    className: inputFiltro(filtros[k]), "data-filtro": k,
  });

  const acoes = (c: ContaPagarView) => (
    <ContaPagarAcoes conta={{ id: c.id, numero: c.numero, fornecedor: c.fornecedor.nome, valorTotal: c.valorTotal, valorPago: c.valorPago, saldoRestante: c.saldoRestante, status: c.status }} menu />
  );

  // Nada no período: oferece todo o período (conta antiga, link de outra tela)
  const Vazio = () => (
    <div className="flex flex-col items-center gap-2 py-10 text-center" data-lista-vazia>
      <p className="text-sm font-medium text-ink">{periodo.tipo === "todos" ? "Nenhuma conta a pagar encontrada" : `Nenhuma conta a pagar em ${periodo.tipo === "mes" ? periodo.rotulo.toLowerCase() : "o período"}`}</p>
      {periodo.tipo !== "todos" && (
        <button type="button" onClick={() => navegar({ mes: null, de: null, ate: null, periodo: "todos" })} className="text-sm text-primary-600 hover:underline" data-ver-todo-periodo>Ver todo o período</button>
      )}
    </div>
  );

  const inputCls = "bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  const CARDS: { key: CardKey; rotulo: string; icone: ComponentType<{ className?: string }>; cor: string; dica?: string }[] = [
    { key: "VENCIDO", rotulo: "Vencidos", icone: AlertTriangle, cor: "text-atrasado", dica: "Pelo saldo que falta pagar (inclui as pagas em parte)." },
    { key: "VENCE_HOJE", rotulo: "Vencem hoje", icone: CalendarClock, cor: "text-atencao-texto" },
    { key: "A_VENCER", rotulo: "A vencer", icone: Receipt, cor: "text-primary-600", dica: "Pelo saldo que falta pagar (inclui as pagas em parte e as sem vencimento)." },
    { key: "PAGO", rotulo: "Pagos", icone: CheckCircle2, cor: "text-success-600", dica: "Contas quitadas, pelo valor pago." },
    { key: "TOTAL", rotulo: "Total do período", icone: Sigma, cor: "text-ink", dica: "Valor de todas as contas do período, menos as canceladas." },
  ];

  /** Nota de compra (link) ou pedido de compra de onde a conta veio */
  const Origem = ({ c, className }: { c: ContaPagarView; className?: string }) => c.notaCompra ? (
    <Link href={`/estoque/notas/${c.notaCompra.id}`} title={`NF ${c.notaCompra.numero}`} className={cn("inline-flex items-center gap-1 text-[11px] text-acento hover:underline", className)} data-origem-conta>
      <FileText className="w-3 h-3 shrink-0" /><span className="truncate">NF {c.notaCompra.numero}</span>
    </Link>
  ) : c.pedidoCompra ? (
    <span className={cn("inline-flex items-center gap-1 text-[11px] text-ink-muted", className)} title={`Pedido ${c.pedidoCompra.numero}`} data-origem-conta>
      <ShoppingCart className="w-3 h-3 shrink-0" /><span className="truncate">Pedido {c.pedidoCompra.numero}</span>
    </span>
  ) : null;

  const marcasFornecedor = (c: ContaPagarView) => (
    <>
      {!c.fornecedor.ativo && <span className="ml-1 text-[10px] font-semibold text-ink-muted">(inativo)</span>}
      {c.fornecedor.semCadastro && <span className="ml-1 text-[10px] font-semibold text-atencao-texto" title="Fornecedor só em texto: escolha o cadastro na edição">(sem cadastro)</span>}
    </>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><Upload className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Contas a Pagar</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {podeImportarNf && (
            <Link href="/estoque/notas?de=contas-pagar" data-lancar-nf className="inline-flex items-center gap-2 bg-white border border-surface-border hover:border-primary-300 hover:bg-primary-50/40 text-ink px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm">
              <FileText className="w-4 h-4 text-primary-600" /> Lançar a partir de NF
            </Link>
          )}
          <Link href="/financeiro/contas-pagar/nova" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
            <Plus className="w-4 h-4" /> Nova Conta
          </Link>
        </div>
      </div>

      {/* Barra enxuta: período (pelo vencimento) + busca + "Mais filtros" (painel recolhido) — padrão da casa */}
      <BarraFiltros
        periodo={<BarraPeriodo rotulo="Vencimento" periodo={periodo} navegar={navegar} permitirTodos dica="Pela data de vencimento." />}
        busca={<CampoBusca valor={busca} onChange={setBusca} placeholder="Pesquisar" rotulo="Buscar contas a pagar" carregando={pendente} />}
        paramBusca="fornecedor" navegar={navegar}
        filtros={[
          { id: "status", label: "Status", params: ["status"], render: () => (
            <select {...sel("status")} aria-label="Status">
              <option value="">Todos</option>
              {Object.entries(LABELS_STATUS_CONTA_PAGAR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ) },
          { id: "fornecedorId", label: "Fornecedor", params: ["fornecedorId"], render: () => (
            <select {...sel("fornecedorId")} aria-label="Fornecedor cadastrado">
              <option value="">Todos</option>
              {fornecedores.map((x) => <option key={x.id} value={x.id}>{x.ativo ? x.nome : `${x.nome} (inativo)`}</option>)}
            </select>
          ) },
          { id: "categoria", label: "Categoria", params: ["categoria"], render: () => (
            <select {...sel("categoria")} aria-label="Categoria">
              <option value="">Todas</option>
              {/* Filtro: inclui as inativas (contas antigas continuam filtráveis) */}
              {categorias.map((x) => <option key={x.id} value={x.id}>{x.ativo ? x.nome : `${x.nome} (inativa)`}</option>)}
            </select>
          ) },
          { id: "centro", label: "Centro de custo", params: ["centro"], render: () => (
            <select {...sel("centro")} aria-label="Centro de custo">
              <option value="">Todos</option>
              {centros.map((x) => <option key={x.id} value={x.id}>{x.ativo ? x.nome : `${x.nome} (inativo)`}</option>)}
            </select>
          ) },
          { id: "origem", label: "Origem", params: ["origem"], render: () => (
            <select {...sel("origem")} aria-label="Origem">
              <option value="">Todas</option>
              <option value="MANUAL">Manual</option>
              <option value="PEDIDO">Pedido de compra</option>
              <option value="NF">Nota de compra (NF)</option>
            </select>
          ) },
        ]}
      />
      <GradeCards colunas={5}>
        {CARDS.map((c) => (
          <CardResumo key={c.key} id={c.key} rotulo={c.rotulo} icone={c.icone} cor={c.cor} dica={c.dica}
            v={resumo[c.key].v} q={resumo[c.key].q} unidade={["conta", "contas"]}
            ativo={card === c.key} onClick={() => navegar({ card: card === c.key ? null : c.key })} />
        ))}
      </GradeCards>

      <div className="card overflow-hidden">
        {/* Celular: um cartão por conta (toque abre o detalhe; ações no ⋮) */}
        <ul className="md:hidden divide-y divide-surface-border" data-cartoes-pagar>
          {comStatus.length === 0 ? (
            <li><Vazio /></li>
          ) : comStatus.map(({ c, sv }) => (
            <li key={c.id} className={cn("flex items-start gap-3 px-4 py-3", sv.linhaVermelha && "bg-atrasado-claro")} data-cartao-conta={c.id}>
              <Link href={`/financeiro/contas-pagar/${c.id}`} className="flex-1 min-w-0" aria-label={`Ver detalhes de ${c.numero}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-ink truncate">{c.fornecedor.nome}{marcasFornecedor(c)}</p>
                  <p className="font-bold text-ink shrink-0 tabular-nums">{formatarMoeda(c.valorTotal)}</p>
                </div>
                <p className="text-xs text-ink-muted truncate">{c.numero} · {c.descricao}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                  <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full", sv.classe)}>{sv.label}</span>
                  <span className="text-xs text-ink-subtle">{c.dataVencimento ? `Vence ${formatarData(c.dataVencimento)}` : "Sem vencimento"}</span>
                  {c.status === "PAGO_PARCIAL" && <span className="text-xs text-ink-muted">Falta {formatarMoeda(c.saldoRestante)}</span>}
                  {c.notaCompra && <span className="text-xs text-acento">NF {c.notaCompra.numero}</span>}
                  {c.temBoleto && <Barcode className="w-3.5 h-3.5 text-primary-600" aria-label="Boleto colado" />}
                </div>
              </Link>
              <div className="shrink-0 -mr-1">{acoes(c)}</div>
            </li>
          ))}
        </ul>

        {/* Desktop: "cara de planilha" (lib/planilha — o mesmo estilo de Contas a Receber e do orçamento) */}
        <div className="hidden md:block overflow-x-auto" data-tabela-pagar>
          <table className={cn(PLANILHA.tabela, "table-fixed")} data-tabela-planilha>
            <thead>
              <tr className={PLANILHA.cabecalho}>
                <th scope="col" className={cn(PLANILHA.th, "text-left w-[5.75rem]")}>Vencimento</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left hidden lg:table-cell w-[7.5rem]")}>Nº/Doc</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left w-[17%]")}>Fornecedor</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left hidden lg:table-cell")}>Descrição</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left hidden xl:table-cell w-[9rem]")}>Categoria</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left hidden xl:table-cell w-[8rem]")}>Centro de custo</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left w-[8rem]")}>Situação</th>
                <th scope="col" className={cn(PLANILHA.th, "text-right w-[7.5rem]")}>Valor (R$)</th>
                <th scope="col" className={cn(PLANILHA.th, "w-10")}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {comStatus.length === 0 ? (
                <tr><td colSpan={9}><Vazio /></td></tr>
              ) : comStatus.map(({ c, sv }) => (
                <tr key={c.id} data-linha-conta={c.id}
                  className={cn(PLANILHA.linha, "hover:bg-primary-50/40", sv.linhaVermelha && "even:bg-atrasado-claro bg-atrasado-claro hover:bg-atrasado-claro/70")}>
                  <td className={cn(PLANILHA.td, "align-middle tabular-nums whitespace-nowrap text-ink-muted")}>{c.dataVencimento ? formatarData(c.dataVencimento) : "—"}</td>
                  <td className={cn(PLANILHA.td, "align-middle hidden lg:table-cell truncate")}>
                    <Link href={`/financeiro/contas-pagar/${c.id}`} title={c.numero} className="font-mono text-[11px] text-primary-600 hover:underline" data-detalhe-conta={c.numero}>{c.numero}</Link>
                  </td>
                  <td className={cn(PLANILHA.td, "align-middle")}>
                    <p className="font-medium text-ink truncate" data-fornecedor={c.fornecedor.id ?? "sem-cadastro"}
                      title={c.fornecedor.documento ? `${c.fornecedor.nome} · ${formatarCpfCnpj(c.fornecedor.documento)}` : c.fornecedor.nome}>
                      {c.fornecedor.nome}{marcasFornecedor(c)}
                    </p>
                  </td>
                  <td className={cn(PLANILHA.td, "align-middle hidden lg:table-cell")}>
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="min-w-0 truncate text-ink" title={c.descricao}>{c.descricao}</span>
                      <Origem c={c} className="shrink-0 max-w-[45%]" />
                    </div>
                  </td>
                  <td className={cn(PLANILHA.td, "align-middle hidden xl:table-cell")}><CategoriaBadge conta={c} categorias={categorias} linhaUnica /></td>
                  <td className={cn(PLANILHA.td, "align-middle hidden xl:table-cell truncate text-ink-muted")}>
                    {c.centroCusto
                      ? <span title={c.centroCusto.nome} data-centro-custo={c.centroCusto.id}>{c.centroCusto.nome}{!c.centroCusto.ativo && " (inativo)"}</span>
                      : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className={cn(PLANILHA.td, "align-middle")}>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full", sv.classe)} data-situacao>
                        {sv.linhaVermelha && <AlertTriangle className="w-3 h-3" />}{sv.label}
                      </span>
                      {c.temBoleto && <span className="inline-flex text-primary-600" title="Boleto colado: veja no detalhe da conta" data-tem-boleto><Barcode className="w-3.5 h-3.5" /></span>}
                    </span>
                  </td>
                  <td className={cn(PLANILHA.td, PLANILHA.numero, "align-middle font-semibold text-ink")} data-valor>
                    {valorSemMoeda(c.valorTotal)}
                    {/* Pago em parte: o que falta, logo abaixo (o card soma por ele) */}
                    {c.status === "PAGO_PARCIAL" && <span className="block text-[11px] font-normal text-ink-muted" data-saldo>falta {valorSemMoeda(c.saldoRestante)}</span>}
                  </td>
                  <td className={cn(PLANILHA.td, "align-middle text-right py-0.5")}>{acoes(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-surface-border bg-surface-alt/40 space-y-2">
          <Paginacao total={total} pagina={pagina} porPagina={porPagina} onNavegar={navegar} rotulo="contas" />
          <p className="text-sm text-ink-muted" data-total-filtrado>
            Total do filtro: <strong className="text-ink">{formatarMoeda(totalFiltrado)}</strong>{" "}
            <span className="mx-1 text-ink-subtle">·</span>{" "}
            Em aberto: <strong className="text-ink" data-total-aberto>{formatarMoeda(totalAberto)}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}

