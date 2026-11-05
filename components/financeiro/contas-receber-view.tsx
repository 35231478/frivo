"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { RenegociarCobrancas } from "@/components/financeiro/renegociar-modal";
import { motivoSelecaoInvalida } from "@/lib/financeiro/renegociacao";
import { cn, formatarMoeda, formatarData, formatarCpfCnpj, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { ContaReceberAcoes } from "@/components/financeiro/conta-receber-acoes";
import { ContaReceberDetalhes } from "@/components/financeiro/conta-receber-detalhes";
import { origemComLink } from "@/lib/financeiro/conta-receber-gestao";
import { SincronizarBoletos } from "@/components/financeiro/sincronizar-boletos";
import { CategoriaBadge } from "@/components/financeiro/categoria-badge";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import {
  Receipt, AlertTriangle, CalendarClock, CheckCircle2, Search, SlidersHorizontal,
  Plus, Download, Barcode, Loader2, Sigma, TrendingDown, Handshake, X,
} from "lucide-react";
import { BarraPeriodo, CardResumo, GradeCards, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { BarraFiltros, FiltroTextoUrl, inputFiltro } from "@/components/listagem/barra-filtros";
import { CampoBusca, Paginacao } from "@/components/listagem/listagem-ui";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { CheckboxSelecao, CheckboxSelecaoPagina, SelecaoLinhasProvider, useSelecaoLinhas } from "@/components/listagem/selecao-linhas";
import { PainelTotais, type LinhaTotal } from "@/components/listagem/painel-totais";
import { CHAVES_RECEBER, totaisReceber } from "@/lib/listagem/totais-selecao";
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
  /** Perda: o saldo dado como perdido na marcação */
  valorPerda?: number | null;
  /** Faz parte de uma renegociação (a conta nova ou parcela dela) / a renegociação para onde foi o saldo */
  renegociacao?: boolean;
  renegociadaEmNumero?: string | null;
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

type CardKey = "VENCIDO" | "VENCE_HOJE" | "A_VENCER" | "RECEBIDO" | "PERDA" | "TOTAL";

/**
 * Contas a Receber no padrão da casa: período (‹ mês ›, personalizado ou todo o período — pelo
 * VENCIMENTO) + cards do período clicáveis como filtro, e a lista em "cara de planilha" no desktop
 * (cartões no celular). Busca, filtros, período e paginação rodam no SERVIDOR (a URL é a fonte da
 * verdade); a exportação CSV exporta o FILTRO (com o período), não a página.
 */
export function ContasReceberView(props: PropsReceber) {
  // Seleção da página (realce da linha + painel "Total dos N selecionados" + a escolha para renegociar)
  return <SelecaoLinhasProvider idsPagina={props.contas.map((c) => c.id)}><ContasReceberCorpo {...props} /></SelecaoLinhasProvider>;
}

interface PropsReceber {
  contas: ContaView[]; clientes: Opcao[]; categorias: { id: string; nome: string; cor: string; ativo: boolean }[];
  interAtivo: boolean; resumo: ResumoReceber; total: number; totalFiltrado: number;
  /** O que falta receber no filtro (abertas, pelo saldo) */
  abertoFiltrado?: number;
  pagina: number; porPagina: number; filtros: FiltrosReceber; periodo: PeriodoTela;
}

function ContasReceberCorpo({
  contas, clientes, categorias, interAtivo, resumo, total, totalFiltrado, abertoFiltrado, pagina, porPagina, filtros, periodo,
}: PropsReceber) {
  const { pode } = usePermissoes();
  const podeCobrar = pode("financeiro", "contasReceber");
  const { busca, setBusca, navegar, pendente } = useListagemUrl({
    chave: "contas-receber", qAtual: filtros.q, paramBusca: "q", lembrarFiltros: false,
  });
  const [detalheId, setDetalheId] = useState<string | null>(filtros.conta || null);
  const fecharDetalhe = () => { setDetalheId(null); if (filtros.conta) navegar({ conta: null }); };
  const acoes = (c: ContaView) => (
    <ContaReceberAcoes conta={{ ...c, interAtivo }} categorias={categorias} clientes={clientes} onDetalhes={() => setDetalheId(c.id)} />
  );
  // Seleção de linhas (caixa em toda cobrança): pinta a linha, soma no painel do rodapé e, para quem
  // tem Financeiro › Perdas, é a escolha para renegociar (a barra diz por que não dá, se não der)
  const router = useRouter();
  const podeRenegociar = pode("financeiro", "perdas");
  const { selecionados, limpar } = useSelecaoLinhas();
  const [renegociando, setRenegociando] = useState(false);
  const selecionadas = useMemo(() => contas.filter((c) => selecionados.has(c.id)), [contas, selecionados]);
  const listaEscolhidas = podeRenegociar ? selecionadas : [];
  const motivoEscolha = listaEscolhidas.length ? motivoSelecaoInvalida(listaEscolhidas) : null;
  const saldoEscolhidas = listaEscolhidas.reduce((s, c) => s + saldoDaConta(c), 0);
  const caixa = (c: ContaView) => <CheckboxSelecao id={c.id} rotulo={c.numero} data-escolher-conta={c.id} />;
  // Painel do rodapé: totais do período (os cards) ou só das marcadas (lib/listagem/totais-selecao)
  const totaisSelecao = useMemo(() => totaisReceber(selecionadas), [selecionadas]);
  const statusChips = useMemo(() => new Set(filtros.status.split(",").filter(Boolean)), [filtros.status]);
  const card = filtros.card as CardKey | "";

  const comStatus = useMemo(() => contas.map((c) => ({ c, sv: statusVisualReceber(c.status, c.dataVencimento) })), [contas]);
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
    { key: "PERDA", rotulo: "Perdas", icone: TrendingDown, cor: "text-atrasado-texto", dica: "Cobranças do período dadas como perdidas, pelo valor perdido. O relatório por cliente fica em Perdas." },
    { key: "TOTAL", rotulo: "Total do período", icone: Sigma, cor: "text-ink", dica: "Todas as cobranças do período, menos as canceladas. A renegociação não soma de novo: conta a cobrança original." },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><Receipt className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Contas a Receber</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* No celular só o ícone (a linha de botões não pode estourar a largura) */}
          <Link href="/financeiro/perdas" aria-label="Perdas" title="Perdas com clientes" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-surface-border text-ink-muted hover:bg-surface-alt transition-colors" data-link-perdas><TrendingDown className="w-4 h-4" /><span className="hidden sm:inline">Perdas</span></Link>
          {interAtivo && <SincronizarBoletos />}
          <button onClick={exportar} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-surface-border text-ink-muted hover:bg-surface-alt transition-colors"><Download className="w-4 h-4" /> Exportar</button>
          {/* UX-8 (G14): o botão segue a MESMA permissão do POST de criação — nunca leva a um 403 */}
          {podeCobrar && <Link href="/financeiro/contas-receber/nova" data-nova-cobranca className="inline-flex items-center gap-1.5 bg-success-500 hover:bg-success-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm"><Plus className="w-4 h-4" /> Nova Cobrança</Link>}
        </div>
      </div>

      {/* Barra enxuta: período (pelo vencimento) + busca + "Mais filtros" (painel recolhido) — padrão da casa */}
      <BarraFiltros
        periodo={<BarraPeriodo rotulo="Vencimento" periodo={periodo} navegar={navegar} permitirTodos dica="Pela data de vencimento." />}
        busca={<CampoBusca valor={busca} onChange={setBusca} placeholder="Pesquisar" rotulo="Buscar cobranças" carregando={pendente} />}
        paramBusca="q" navegar={navegar}
        filtros={[
          { id: "clienteId", label: "Cliente", params: ["clienteId"], render: () => (
            <select value={filtros.clienteId} onChange={(e) => navegar({ clienteId: e.target.value || null })} className={inputFiltro(filtros.clienteId)} aria-label="Cliente" data-filtro="clienteId">
              <option value="">Todos</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          ) },
          { id: "categoria", label: "Categoria", params: ["categoria"], render: () => (
            <select value={filtros.categoria} onChange={(e) => navegar({ categoria: e.target.value || null })} className={inputFiltro(filtros.categoria)} aria-label="Categoria" data-filtro="categoria">
              <option value="">Todas</option>
              {/* Filtro: inclui as inativas (contas antigas continuam filtráveis) */}
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.ativo ? c.nome : `${c.nome} (inativa)`}</option>)}
            </select>
          ) },
          { id: "forma", label: "Forma de pagamento", params: ["forma"], render: () => (
            <select value={filtros.forma} onChange={(e) => navegar({ forma: e.target.value || null })} className={inputFiltro(filtros.forma)} aria-label="Forma de pagamento" data-filtro="forma">
              <option value="">Todas</option>
              {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ) },
          { id: "banco", label: "Banco", params: ["banco"], render: () => <FiltroTextoUrl param="banco" navegar={navegar} placeholder="Banco" rotulo="Banco" /> },
          { id: "valor", label: "Valor (de / até)", params: ["valorMin", "valorMax"], render: () => (
            <div className="flex gap-2">
              <FiltroTextoUrl param="valorMin" navegar={navegar} tipo="number" placeholder="0,00" rotulo="Valor de" />
              <FiltroTextoUrl param="valorMax" navegar={navegar} tipo="number" placeholder="0,00" rotulo="Valor até" />
            </div>
          ) },
          { id: "status", label: "Status", params: ["status"], largo: true, render: () => (
            <div className="flex flex-wrap gap-1.5">
              {(["PREVISTO", "A_VENCER", "VENCE_HOJE", "VENCIDO", "PARCIAL", "PAGO", "PERDA", "RENEGOCIADO", "CANCELADO"] as const).map((s) => (
                <button key={s} type="button" data-chip-status={s} onClick={() => toggleStatus(s)} aria-pressed={statusChips.has(s)}
                  className={cn("text-xs px-2.5 py-1 rounded-full border transition-colors", statusChips.has(s) ? "bg-primary-500 border-primary-500 text-white" : "bg-white border-surface-border text-ink-muted hover:border-primary-300")}>
                  {LABEL_CHAVE[s]}
                </button>
              ))}
            </div>
          ) },
        ]}
      />
      <GradeCards colunas={6}>
        {CARDS.map((c) => (
          <CardResumo key={c.key} id={c.key} rotulo={c.rotulo} icone={c.icone} cor={c.cor} dica={c.dica}
            v={resumo[c.key].v} q={resumo[c.key].q} unidade={["cobrança", "cobranças"]}
            ativo={card === c.key} onClick={() => navegar({ card: card === c.key ? null : c.key })} />
        ))}
      </GradeCards>

      <div className="card overflow-hidden">
        {/* Celular: um cartão por conta (toque abre os detalhes; ações no ⋮) */}
        <ul className="md:hidden divide-y divide-surface-border" data-cartoes-receber>
          {comStatus.length === 0 ? (
            <li><Vazio /></li>
          ) : comStatus.map(({ c, sv }) => {
            const origem = origemComLink(c);
            return (
              <li key={c.id} className={cn("flex items-start gap-3 px-4 py-3", sv.linhaVermelha && "bg-atrasado-claro", selecionados.has(c.id) && "bg-primary-50")} data-cartao-conta={c.id} data-selecionada={selecionados.has(c.id) ? "" : undefined}>
                <div className="pt-1 w-4 shrink-0">{caixa(c)}</div>
                <button type="button" onClick={() => setDetalheId(c.id)} className="flex-1 min-w-0 text-left" aria-label={`Ver detalhes de ${c.numero}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-ink truncate">{c.clienteNome}</p>
                    <p className="font-bold text-success-700 shrink-0">{formatarMoeda(c.valor)}</p>
                  </div>
                  <p className="text-xs text-ink-muted truncate">{c.numero} · {c.descricao}</p>
                  {c.status === "RENEGOCIADO" && (
                    <p className="text-xs text-ink-muted mt-0.5" data-renegociada-cartao>
                      Renegociada{c.renegociadaEmNumero ? ` em ${c.renegociadaEmNumero}` : ""}{(c.valorRecebido ?? 0) > 0 && ` · recebido ${formatarMoeda(c.valorRecebido ?? 0)}`}
                    </p>
                  )}
                  {c.status === "PERDA" && (
                    <p className="text-xs text-ink-muted mt-0.5" data-perda-cartao>
                      Perdido <strong className="text-ink">{formatarMoeda(c.valorPerda ?? 0)}</strong>{(c.valorRecebido ?? 0) > 0 && ` · recebido ${formatarMoeda(c.valorRecebido ?? 0)}`}
                    </p>
                  )}
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

        {/* Desktop: a tabela profissional (components/listagem/tabela-pro — colunas redimensionáveis, menu "Colunas", preferência por usuário) */}
        <div data-tabela-receber>
          {comStatus.length === 0 ? <div className="hidden md:block"><Vazio /></div> : (
            <TabelaPro
              tela="contas-receber"
              colunas={[
                { id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: <CheckboxSelecaoPagina />, classe: "pl-3" } satisfies ColunaPro,
                { id: "vencimento", titulo: "Vencimento", largura: 96 },
                { id: "numero", titulo: "Nº", largura: 136, classe: "truncate" },
                { id: "cliente", titulo: "Cliente", largura: 220, obrigatoria: true },
                { id: "descricao", titulo: "Descrição" },
                { id: "categoria", titulo: "Categoria", largura: 160 },
                { id: "situacao", titulo: "Situação", largura: 128 },
                { id: "valor", titulo: "Valor (R$)", alinhar: "direita", largura: 120, obrigatoria: true },
                { id: "emAberto", titulo: "Em aberto (R$)", alinhar: "direita", largura: 120 },
                { id: "acoes", titulo: "Ações", fixa: true, largura: 40, semTitulo: true, alinhar: "direita", classe: "py-0.5" },
              ]}
              linhas={comStatus.map(({ c, sv }) => {
                const origem = origemComLink(c);
                return {
                  id: c.id,
                  atributos: { "data-linha-conta": c.id },
                  classe: sv.linhaVermelha ? "even:bg-atrasado-claro bg-atrasado-claro hover:bg-atrasado-claro/70" : undefined,
                  titulos: { numero: c.numero },
                  celulas: {
                    sel: caixa(c),
                    vencimento: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{c.dataVencimento ? formatarData(c.dataVencimento) : "—"}</span>,
                    numero: <span className={cn(PLANILHA.codigo, "font-normal text-ink-subtle")} data-numero-conta>{c.numero}</span>,
                    cliente: <p className={cn(PLANILHA.nome, "truncate")} title={c.clienteCnpj ? `${c.clienteNome} · ${formatarCpfCnpj(c.clienteCnpj)}` : c.clienteNome}>{c.clienteNome}</p>,
                    descricao: (
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <button type="button" onClick={() => setDetalheId(c.id)} title={c.descricao} className="min-w-0 text-left text-ink hover:text-primary-600 truncate" data-abrir-detalhes={c.id}>{c.descricao}</button>
                        {origem && <Link href={origem.href} title={origem.rotulo} className="shrink-0 max-w-[45%] truncate text-[11px] text-acento hover:underline" data-origem-conta>{origem.rotulo}</Link>}
                      </div>
                    ),
                    categoria: <CategoriaBadge conta={c} categorias={categorias} linhaUnica />,
                    situacao: (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full", sv.classe)} data-situacao>
                          {sv.linhaVermelha && <AlertTriangle className="w-3 h-3" />}{sv.label}
                        </span>
                        {recebidaEmParte(c) && <SeloParcial />}
                        {c.boletoStatus === "EMITIDO" && <Barcode className="w-3.5 h-3.5 text-ok-texto" aria-label="Boleto emitido" />}
                      </span>
                    ),
                    valor: <span className={cn(PLANILHA.numero, "font-semibold text-ink")} data-valor>{valorSemMoeda(c.valor)}</span>,
                    // O que falta: igual ao valor sem baixa; menor na baixa parcial; 0 na recebida/cancelada
                    emAberto: (
                      <span className={cn(PLANILHA.numero, recebidaEmParte(c) ? "font-semibold text-atencao-texto" : "text-ink-muted")} data-em-aberto>
                        {c.status === "CANCELADO" ? "—"
                          : c.status === "PERDA" ? <span title={`Perdido: ${formatarMoeda(c.valorPerda ?? 0)}`} data-perdido>—</span>
                          : c.status === "RENEGOCIADO" ? <span title={c.renegociadaEmNumero ? `Renegociada em ${c.renegociadaEmNumero}` : "Renegociada"} data-renegociada>—</span>
                          : valorSemMoeda(saldoDaConta(c))}
                      </span>
                    ),
                    acoes: acoes(c),
                  },
                };
              })}
            />
          )}
        </div>

        <PainelTotais unidade={["cobrança", "cobranças"]}
          periodo={{
            rotulo: periodo.rotulo, subtitulo: periodo.tipo === "todos" ? "Todo o período" : periodo.rotulo,
            total: linhaTotal("TOTAL", resumo.TOTAL),
            linhas: CHAVES_RECEBER.filter((k) => k !== "TOTAL").map((k) => linhaTotal(k, resumo[k])),
          }}
          selecao={{ n: selecionados.size, naPagina: selecionadas.length, total: linhaTotal("TOTAL", totaisSelecao.TOTAL), linhas: CHAVES_RECEBER.filter((k) => k !== "TOTAL").map((k) => linhaTotal(k, totaisSelecao[k])) }}
        />
        <div className="px-4 py-3 border-t border-surface-border bg-surface-alt/40 space-y-2">
          <Paginacao total={total} pagina={pagina} porPagina={porPagina} onNavegar={navegar} rotulo="cobranças" />
          <p className="text-sm text-ink-muted" data-total-filtrado>
            Total do filtro: <strong className="text-ink">{formatarMoeda(totalFiltrado)}</strong>
            {abertoFiltrado != null && <> · em aberto: <strong className="text-ink" data-aberto-filtrado>{formatarMoeda(abertoFiltrado)}</strong></>}
          </p>
        </div>
      </div>
      {/* Com a barra flutuante na tela, um respiro no fim para o painel de totais rolar acima dela */}
      {listaEscolhidas.length > 0 && <div className="h-24 md:h-20" aria-hidden data-espaco-barra />}
      <ContaReceberDetalhes id={detalheId} onFechar={fecharDetalhe} onAbrirConta={setDetalheId} />

      {/* Barra da escolha: quantas, quanto falta, e "Renegociar" (mesmo cliente) */}
      {listaEscolhidas.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 md:bottom-4 z-30 flex justify-center px-4 pointer-events-none" data-barra-renegociar>
          <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-surface-border bg-white shadow-card-hover px-4 py-3 max-w-full">
            <span className="text-sm text-ink">
              <strong>{listaEscolhidas.length}</strong> {listaEscolhidas.length === 1 ? "cobrança" : "cobranças"} · falta <strong className="tabular-nums">{formatarMoeda(saldoEscolhidas)}</strong>
            </span>
            {motivoEscolha && <span role="alert" className="text-xs text-atencao-texto" data-motivo-escolha>{motivoEscolha}</span>}
            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={limpar} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink px-2 py-1.5" data-limpar-escolha><X className="w-3.5 h-3.5" /> Limpar</button>
              <button type="button" onClick={() => setRenegociando(true)} disabled={!!motivoEscolha}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 px-4 py-2 rounded-lg disabled:opacity-50" data-abrir-renegociar>
                <Handshake className="w-4 h-4" /> Renegociar
              </button>
            </div>
          </div>
        </div>
      )}
      <Modal aberto={renegociando} onFechar={() => setRenegociando(false)} titulo={`Renegociar — ${listaEscolhidas[0]?.clienteNome ?? ""}`} tamanho="lg">
        {renegociando && listaEscolhidas.length > 0 && (
          <RenegociarCobrancas clienteId={listaEscolhidas[0].clienteId} clienteNome={listaEscolhidas[0].clienteNome} iniciais={listaEscolhidas.map((c) => c.id)}
            onPronto={() => { setRenegociando(false); limpar(); router.refresh(); }} onCancelar={() => setRenegociando(false)} />
        )}
      </Modal>
    </div>
  );
}

/** Uma linha do painel de totais com o rótulo e a cor do card correspondente */
const ROTULO_TOTAL: Record<string, { rotulo: string; cor?: string }> = {
  VENCIDO: { rotulo: "Em aberto (Vencido)", cor: "text-atrasado" }, VENCE_HOJE: { rotulo: "Em aberto (Vence hoje)", cor: "text-atencao-texto" },
  A_VENCER: { rotulo: "Em aberto (A vencer)" }, RECEBIDO: { rotulo: "Recebidos", cor: "text-success-600" }, PERDA: { rotulo: "Perdas", cor: "text-atrasado-texto" },
  TOTAL: { rotulo: "Total" },
};
const linhaTotal = (chave: string, s: { v: number; q: number }): LinhaTotal => ({ chave, ...ROTULO_TOTAL[chave], v: s.v, q: s.q });

const LABEL_CHAVE: Record<string, string> = { PREVISTO: "Previsto", A_VENCER: "A vencer", VENCE_HOJE: "Vence hoje", VENCIDO: "Vencido", PARCIAL: "Recebido em parte", PAGO: "Pago", PERDA: "Perda", RENEGOCIADO: "Renegociada", CANCELADO: "Cancelado" };

/** Baixa parcial: entrou uma parte e ainda falta (a situação continua a do vencimento) */
function SeloParcial() {
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-atencao-claro text-atencao-texto" data-selo-parcial>Parcial</span>;
}

