"use client";

import { casaCodigo } from "@/lib/cadastros/codigos";
import { descricaoDoCatalogo } from "@/lib/orcamentos/proposta";
import { useState, useRef, useEffect, useId, type InputHTMLAttributes } from "react";
import { cn, formatarMoeda } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";
import { AlertTriangle, Plus, Trash2, Search, X, Lock, LockOpen, MessageSquarePlus } from "lucide-react";
import {
  CadastroRapidoModal, usePodeCriar, type CampoRapido, type EntidadeCadastro, type PermissaoCriar,
} from "@/components/ui/select-cadastro-rapido";
import { round2, totalDoItem, totalDoUnitario, unitarioDoTotal } from "@/lib/orcamentos/calculo";
import { valorDaLinha, type MaterialOrcamento } from "@/lib/orcamentos/materiais";

export interface ItemTabela {
  id: string;            // uuid local
  catalogoId?: string | null;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  /** Total da linha quando foi DIGITADO (o total manda: o unitário vem dele). Ausente = unitário × qtd. */
  valorTotal?: number | null;
  observacao?: string | null;
  bloqueado?: boolean;
  origemPreco?: "contrato" | "padrao" | "fora_tabela";
  valorPadraoCadastro?: number;
  /** E3.3 (serviço): snapshot dos materiais/peças da linha; com eles, `valorUnitario` é o BASE e o total = base + ajuste */
  materiais?: MaterialOrcamento[];
  /** E3.3: o total digitado na mão vale (não segue base + ajuste) */
  valorManual?: boolean;
  /** E3.3 (produto): peça derivada de um material de serviço — linha só de leitura, recomposta das linhas de serviço */
  derivada?: { deServico: string };
}

export interface CatalogoItem {
  id: string;
  /** Código do produto (número) ou do serviço (ex.: LIMP01): a busca acha por ele */
  codigo?: string | number | null;
  nome: string;
  descricao?: string | null;
  unidade?: string | null;
  valorPadrao?: unknown; // Decimal | number | null
  /** E3.3 (serviço): tem composição (materiais padrão) para materializar ao entrar no orçamento */
  temMateriais?: boolean;
}

/**
 * A tabela de preços do cliente (de /api/clientes/{id}/tabela-preco). Só existe quando o cliente tem tabela
 * ATIVA: o seletor mostra os itens dela (cadeado abre o catálogo todo) com o preço dela. Sem tabela, o
 * seletor mostra o catálogo padrão da empresa com o preço padrão de cada item.
 */
export interface TabelaPrecoCliente {
  nome: string;
  tipo: string;
  precosBloqueados: boolean;
  itens: Record<string, { valorFinal: number; bloqueado: boolean; tipoPreco: string; descontoPercent: number | null }>;
}

/** Cadastro rápido de item de catálogo (produto/serviço) direto da busca. */
export interface CadastroCatalogo {
  entidade: EntidadeCadastro;
  campos: CampoRapido[];
  permissao: PermissaoCriar;
  link?: string;
  /** Cria na API e devolve o item de catálogo (o pai também o inclui no catálogo). */
  criar: (valores: Record<string, string>) => Promise<CatalogoItem>;
}

interface ItensTabelaProps {
  titulo: string;
  /** Explicação da tabela, no ⓘ ao lado do título (ex.: as linhas valem só neste documento) */
  dica?: string;
  labelAdicionar: string;
  catalogo: CatalogoItem[];
  itens: ItemTabela[];
  onChange: (itens: ItemTabela[]) => void;
  tabela?: TabelaPrecoCliente | null;
  cadastro?: CadastroCatalogo;
  /**
   * O TOTAL da linha também é digitável (orçamento): editar o unitário recalcula o total
   * (unitário × qtd); editar o total recalcula o unitário (total ÷ qtd, em centavos).
   */
  totalEditavel?: boolean;
  /** E3.3: conteúdo extra embaixo da linha (o painel de materiais do serviço) */
  extraLinha?: (it: ItemTabela) => React.ReactNode;
  /** E3.3: avisa quem adicionou um item do catálogo (para materializar a composição do serviço) */
  onAdicionadoDoCatalogo?: (it: ItemTabela, c: CatalogoItem) => void;
}

function novoId() {
  return Math.random().toString(36).slice(2);
}

/** "1.234,56" / "1234.56" / "33,3" → número (vazio/ruim = 0) */
export function lerNumeroBR(texto: string): number {
  const t = texto.trim();
  if (!t) return 0;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : 0;
}
const mostrarNumero = (v: number, casas?: number) =>
  !Number.isFinite(v) ? "" : (casas != null ? v.toFixed(casas) : String(round2(v))).replace(".", ",");

/**
 * Campo numérico em pt-BR (vírgula) que não "pula" enquanto se digita: guarda o texto digitado e
 * só reformata ao sair do campo ou quando o valor muda por fora (ex.: o total recalculou o unitário).
 */
export function CampoNumero({ valor, onValor, casas, className, ...props }: {
  valor: number; onValor: (v: number) => void; casas?: number;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [texto, setTexto] = useState(mostrarNumero(valor, casas));
  const focado = useRef(false);
  useEffect(() => { if (!focado.current) setTexto(mostrarNumero(valor, casas)); }, [valor, casas]);
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...props}
      value={texto}
      onFocus={(e) => { focado.current = true; e.currentTarget.select(); }}
      onBlur={() => { focado.current = false; setTexto(mostrarNumero(valor, casas)); }}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,]/g, "");
        setTexto(t);
        onValor(lerNumeroBR(t));
      }}
      className={cn(
        "w-full text-right bg-white sm:bg-transparent border border-surface-border sm:border-transparent sm:hover:border-surface-border text-ink rounded-md px-2 py-1.5 sm:py-0.5",
        "focus:outline-none focus:border-acento focus:bg-white focus:ring-2 focus:ring-acento/15 tabular-nums",
        className,
      )}
    />
  );
}

/**
 * Observação do item — aparece no orçamento do cliente.
 * Desktop: coluna própria à direita da descrição, uma linha que cresce com o texto.
 * Celular: botão "Adicionar observação" que abre o campo no cartão do item.
 */
function ObservacaoItem({ valor, onChange, descricao }: { valor: string; onChange: (v: string) => void; descricao: string }) {
  const [aberta, setAberta] = useState(!!valor);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const ajustar = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useEffect(() => { if (valor) setAberta(true); }, [valor]);
  useEffect(ajustar, [aberta, valor]);
  const mostrar = aberta || !!valor;

  return (
    <div className="min-w-0" data-observacao-item={mostrar ? "" : undefined}>
      {!mostrar && (
        <button
          type="button"
          onClick={() => { setAberta(true); setTimeout(() => ref.current?.focus(), 0); }}
          className="sm:hidden inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md px-2 py-1 -ml-2"
          data-abrir-observacao
        >
          <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden /> Adicionar observação
        </button>
      )}
      <div className={cn(!mostrar && "hidden sm:block")}>
        <label htmlFor={id} className="block sm:sr-only text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-0.5">
          Observação do item <span className="normal-case font-normal tracking-normal">· aparece no orçamento do cliente</span>
        </label>
        <textarea
          id={id}
          ref={ref}
          rows={1}
          value={valor}
          aria-label={`Observação de ${descricao || "item"}`}
          title="Aparece no orçamento do cliente"
          onChange={(e) => onChange(e.target.value)}
          onInput={ajustar}
          onBlur={() => { if (!valor.trim()) setAberta(false); }}
          placeholder="Observação (sai para o cliente)"
          className={cn(
            "block w-full resize-none overflow-hidden rounded-md text-sm leading-snug text-ink placeholder:text-ink-subtle",
            "bg-white border border-surface-border px-2.5 py-1.5 min-h-[56px]",
            "sm:bg-transparent sm:border-transparent sm:px-2 sm:py-0.5 sm:min-h-0 sm:text-[13px] sm:text-ink-muted sm:hover:border-surface-border",
            "focus:outline-none focus:bg-white focus:text-ink focus:border-acento focus:ring-2 focus:ring-acento/15",
          )}
        />
      </div>
    </div>
  );
}

// Desktop: Descrição | Observação | Qtd | Unitário | Total | (excluir) — linhas compactas, tipo planilha
const COLUNAS = "grid grid-cols-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_4.5rem_7.25rem_7.25rem_2rem] gap-x-2 sm:gap-x-3";
const rotuloCelular = "block sm:sr-only text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-0.5";

export function ItensTabela({ titulo, dica, labelAdicionar, catalogo, itens, onChange, tabela, cadastro, totalEditavel = false, extraLinha, onAdicionadoDoCatalogo }: ItensTabelaProps) {
  function atualizar(id: string, patch: Partial<ItemTabela>) {
    onChange(itens.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  const comMateriais = (it: ItemTabela) => !!it.materiais?.length;
  // Unitário e quantidade mandam no total; o total digitado manda no unitário.
  // Com materiais (E3.3): unitário/quantidade mudam a BASE (o total segue base + ajuste); o total digitado vira valor manual
  function mudarQuantidade(it: ItemTabela, quantidade: number) {
    if (comMateriais(it)) return atualizar(it.id, { quantidade });
    atualizar(it.id, { quantidade, valorTotal: totalEditavel ? totalDoUnitario(quantidade, it.valorUnitario) : it.valorTotal });
  }
  function mudarUnitario(it: ItemTabela, valorUnitario: number) {
    if (comMateriais(it)) return atualizar(it.id, { valorUnitario });
    atualizar(it.id, { valorUnitario, valorTotal: totalEditavel ? totalDoUnitario(it.quantidade, valorUnitario) : it.valorTotal });
  }
  function mudarTotal(it: ItemTabela, valorTotal: number) {
    if (comMateriais(it)) return atualizar(it.id, { valorTotal, valorManual: true });
    atualizar(it.id, { valorTotal, valorUnitario: unitarioDoTotal(valorTotal, it.quantidade) });
  }
  function remover(id: string) {
    onChange(itens.filter((it) => it.id !== id));
  }
  function adicionarVazio() {
    onChange([
      ...itens,
      { id: novoId(), descricao: "", quantidade: 1, valorUnitario: 0 },
    ]);
  }
  function adicionarDoCatalogo(c: CatalogoItem) {
    const padrao = c.valorPadrao == null ? 0 : Number(c.valorPadrao);
    const tItem = tabela?.itens[c.id];
    let valorUnitario = padrao;
    let bloqueado = false;
    // Sem tabela vinculada: comportamento padrão (sem badge).
    // Com tabela: item presente => "contrato"; ausente (via "mostrar todos") => "fora_tabela".
    let origemPreco: ItemTabela["origemPreco"] = tabela ? "fora_tabela" : undefined;
    if (tItem) {
      valorUnitario = tItem.valorFinal;
      bloqueado = (tabela?.precosBloqueados ?? false) || tItem.bloqueado;
      origemPreco = "contrato";
    }
    const novo: ItemTabela = {
      id: novoId(),
      catalogoId: c.id,
      descricao: descricaoDoCatalogo(c.nome, c.descricao),
      quantidade: 1,
      valorUnitario,
      bloqueado,
      origemPreco,
      valorPadraoCadastro: padrao,
    };
    onChange([...itens, novo]);
    onAdicionadoDoCatalogo?.(novo, c);
  }

  // Mesmo cálculo do servidor (lib/orcamentos/calculo.ts; com materiais, lib/orcamentos/materiais.ts)
  const totalLinha = (it: ItemTabela) => (comMateriais(it) ? valorDaLinha(it).valorTotal : totalEditavel ? totalDoItem(it) : totalDoUnitario(it.quantidade, it.valorUnitario));
  const subtotal = round2(itens.reduce((acc, it) => acc + totalLinha(it), 0));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="section-title flex items-center gap-1.5">{titulo}{dica && <Dica texto={dica} rotulo={titulo} />}</h3>
        <div className="text-sm">
          <span className="text-ink-muted">Subtotal: </span>
          <span className="font-bold text-ink tabular-nums" data-subtotal-grupo>{formatarMoeda(subtotal)}</span>
        </div>
      </div>

      <div className="border border-surface-border rounded-lg overflow-hidden" role="table" aria-label={titulo}>
        <div className={cn(COLUNAS, "hidden sm:grid bg-surface-alt border-b border-surface-border px-3 py-1.5")} role="row">
          {["Descrição", "Observação", "Qtd", "Unitário", "Total"].map((c, i) => (
            <span key={c} role="columnheader" className={cn("font-semibold text-ink-muted text-[11px] uppercase tracking-wider", i === 1 && "sm:pl-3", i > 1 && "text-right")}>{c}</span>
          ))}
          <span role="columnheader" className="sr-only">Ações</span>
        </div>

        {itens.length === 0 && (
          <p className="text-center text-sm text-ink-subtle py-6 italic">Nenhum item adicionado.</p>
        )}

        {itens.map((it) => {
          const total = totalLinha(it);
          const precoTitulo = it.origemPreco === "contrato" && it.valorPadraoCadastro != null && it.valorPadraoCadastro !== Number(it.valorUnitario)
            ? `Padrão ${formatarMoeda(it.valorPadraoCadastro)} · aplicado ${formatarMoeda(Number(it.valorUnitario) || 0)}`
            : undefined;
          const derivada = !!it.derivada;
          const travado = it.bloqueado || derivada;
          return (
            <div key={it.id} className="border-b border-surface-border last:border-b-0">
            <div role="row" data-item-linha data-linha-derivada={derivada ? "true" : undefined} data-valor-manual={it.valorManual && comMateriais(it) ? "true" : undefined} className={cn(COLUNAS, "gap-y-2 sm:items-center px-3 py-2.5 sm:py-1 hover:bg-surface-alt/40", derivada && "bg-surface-page/60")}>
              <div role="cell" className="col-span-3 sm:col-span-1 flex items-start sm:items-center gap-2 min-w-0">
                <div className="flex-1 min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-x-1.5">
                  <input
                    value={it.descricao}
                    onChange={(e) => atualizar(it.id, { descricao: e.target.value })}
                    placeholder="Descrição do item"
                    aria-label="Descrição do item"
                    readOnly={derivada}
                    className="basis-full sm:basis-auto flex-1 min-w-0 w-full bg-transparent text-ink font-medium sm:font-normal focus:outline-none focus:bg-primary-50/30 rounded px-1 py-1 sm:py-0.5"
                  />
                  {derivada && (
                    <span className="inline-flex items-center shrink-0 whitespace-nowrap text-[10px] leading-none font-semibold px-1.5 py-1 rounded bg-acento-claro text-acento" title={`Peça dos materiais do serviço “${it.derivada!.deServico}”: edite lá`} data-peca-de={it.derivada!.deServico}>
                      Peça · {it.derivada!.deServico}
                    </span>
                  )}
                  {comMateriais(it) && it.valorManual && (
                    <span className="inline-flex items-center shrink-0 whitespace-nowrap text-[10px] leading-none font-semibold px-1.5 py-1 rounded bg-atencao-claro text-atencao-texto" title="Total digitado na mão: não segue base + materiais">Valor manual</span>
                  )}
                  {it.origemPreco && (
                    <span
                      className={cn(
                        "inline-flex items-center shrink-0 whitespace-nowrap text-[10px] leading-none font-semibold px-1.5 py-1 rounded",
                        it.origemPreco === "contrato" && "bg-ok-claro text-ok-texto",
                        it.origemPreco === "padrao" && "bg-surface-linha text-ink-muted",
                        it.origemPreco === "fora_tabela" && "bg-atencao-claro text-atencao-texto",
                      )}
                    >
                      {it.origemPreco === "contrato"
                        ? "Preço de contrato"
                        : it.origemPreco === "fora_tabela"
                          ? <><AlertTriangle className="w-3 h-3 mr-0.5" aria-hidden />Fora da tabela</>
                          : "Preço padrão"}
                    </span>
                  )}
                </div>
                {!derivada && <button
                  type="button"
                  onClick={() => remover(it.id)}
                  className="sm:hidden p-2 -mr-1 text-ink-muted hover:text-atrasado hover:bg-atrasado-claro rounded transition-colors"
                  title="Excluir"
                  aria-label={`Excluir ${it.descricao || "item"}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>}
              </div>

              {/* Observação: à direita da descrição no desktop (com divisória); no fim do cartão no celular */}
              <div role="cell" className="col-span-3 order-last sm:order-none sm:col-span-1 sm:pl-3 sm:border-l sm:border-surface-linha min-w-0">
                {derivada ? <span className="hidden sm:block text-[11px] text-ink-subtle italic px-2">Cobrada à parte</span> : <ObservacaoItem valor={it.observacao ?? ""} onChange={(v) => atualizar(it.id, { observacao: v })} descricao={it.descricao} />}
              </div>

              <label role="cell" className="block">
                <span className={rotuloCelular}>Qtd</span>
                {derivada ? (
                  <div className="text-right text-ink px-2 py-1.5 sm:py-0.5 tabular-nums" data-campo="quantidade">{String(round2(Number(it.quantidade) || 0)).replace(".", ",")}</div>
                ) : (
                  <CampoNumero valor={Number(it.quantidade) || 0} onValor={(v) => mudarQuantidade(it, v)} aria-label="Quantidade" data-campo="quantidade" />
                )}
              </label>

              <label role="cell" className="block">
                <span className={rotuloCelular}>{comMateriais(it) ? "Unit. base" : "Unitário"}</span>
                {travado ? (
                  <div
                    className="flex items-center justify-end gap-1 bg-surface-alt text-ink-muted rounded px-1.5 py-1.5 sm:py-0.5 cursor-not-allowed"
                    title={derivada ? "Preço da peça: edite nos materiais do serviço" : "Preço definido em contrato — não pode ser alterado"}
                  >
                    {!derivada && <Lock className="w-3 h-3 shrink-0" />}
                    <span className="font-medium tabular-nums">{formatarMoeda(Number(it.valorUnitario) || 0)}</span>
                  </div>
                ) : (
                  <CampoNumero valor={Number(it.valorUnitario) || 0} casas={2} onValor={(v) => mudarUnitario(it, v)} title={precoTitulo} aria-label="Valor unitário" data-campo="unitario" />
                )}
              </label>

              <label role="cell" className="block">
                <span className={rotuloCelular}>Total</span>
                {totalEditavel && !travado ? (
                  <CampoNumero
                    valor={total}
                    casas={2}
                    onValor={(v) => mudarTotal(it, v)}
                    aria-label="Valor total do item"
                    title={comMateriais(it) ? "Total = base + materiais inclusos. Digitar aqui fixa um valor manual" : "Digite o total: o unitário é recalculado (total ÷ quantidade)"}
                    data-campo="total"
                    className="font-semibold"
                  />
                ) : (
                  <div className="text-right font-semibold text-ink px-2 py-1.5 sm:py-0.5 tabular-nums" data-campo="total">{formatarMoeda(total)}</div>
                )}
              </label>

              <div role="cell" className="hidden sm:flex items-center justify-center">
                {!derivada && <button
                  type="button"
                  onClick={() => remover(it.id)}
                  className="p-1 text-ink-muted hover:text-atrasado hover:bg-atrasado-claro rounded transition-colors"
                  title="Excluir"
                  aria-label={`Excluir ${it.descricao || "item"}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>}
              </div>
            </div>
            {extraLinha && !derivada && <div className="px-3">{extraLinha(it)}</div>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <BuscaCatalogo catalogo={catalogo} onSelect={adicionarDoCatalogo} placeholder={labelAdicionar} tabela={tabela} cadastro={cadastro} />
        <button
          type="button"
          onClick={adicionarVazio}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-3 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Linha em branco
        </button>
      </div>
    </div>
  );
}

function BuscaCatalogo({
  catalogo,
  onSelect,
  placeholder,
  tabela,
  cadastro,
}: {
  catalogo: CatalogoItem[];
  onSelect: (c: CatalogoItem) => void;
  placeholder: string;
  tabela?: TabelaPrecoCliente | null;
  cadastro?: CadastroCatalogo;
}) {
  const podeCriar = usePodeCriar(cadastro?.permissao) && !!cadastro;
  const [modal, setModal] = useState(false);
  const [nomeInicial, setNomeInicial] = useState("");
  const [query, setQuery] = useState("");
  const [aberto, setAberto] = useState(false);
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Trocou o cliente (outra tabela, ou nenhuma): o cadeado volta a fechar
  useEffect(() => { setMostrarTodos(false); }, [tabela]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Quando o cliente tem tabela e não está no modo "mostrar todos",
  // a busca exibe apenas os itens presentes na tabela do cliente.
  const restritoTabela = !!tabela && !mostrarTodos;
  const base = restritoTabela ? catalogo.filter((c) => !!tabela!.itens[c.id]) : catalogo;

  const q = query.trim().toLowerCase();
  const filtrados = q
    ? base.filter((c) => c.nome.toLowerCase().includes(q) || (c.descricao ?? "").toLowerCase().includes(q) || casaCodigo(c.codigo, q))
    : base;

  // Preço exibido no dropdown: o da tabela quando o item pertence a ela.
  function precoExibido(c: CatalogoItem): { valor: number | null; contrato: boolean } {
    const t = tabela?.itens[c.id];
    if (t) return { valor: t.valorFinal, contrato: true };
    return { valor: c.valorPadrao != null ? Number(c.valorPadrao) : null, contrato: false };
  }

  return (
    <div className="flex-1 min-w-[240px]" ref={ref}>
      {/* Ícone, campo e lista na mesma caixa: o "Mostrar todos" abaixo não desalinha o ícone */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          placeholder={restritoTabela ? "Pesquisar na tabela do cliente..." : placeholder}
          className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-9 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-subtle hover:text-ink"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {aberto && (
          <div className="absolute z-20 left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-white border border-surface-border rounded-lg shadow-card-hover">
            {filtrados.length === 0 && (
              <p className="px-3 py-3 text-xs text-ink-subtle italic">
                {restritoTabela
                  ? "Nenhum item na tabela do cliente. Use “Mostrar todos”."
                  : catalogo.length === 0 && cadastro
                    ? `Nenhum ${cadastro.entidade.singular} cadastrado.`
                    : "Nenhum item encontrado."}
              </p>
            )}
            {filtrados.slice(0, 20).map((c) => {
              const pe = precoExibido(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onSelect(c); setQuery(""); setAberto(false); }}
                  className="w-full text-left px-3 py-2 hover:bg-primary-50 border-b border-surface-border last:border-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">
                      {c.codigo != null && <span className="font-mono text-xs text-ink-muted mr-1.5" data-codigo-item>{c.codigo}</span>}
                      {c.nome}
                    </p>
                    {c.descricao && <p className="text-xs text-ink-muted truncate">{c.descricao}</p>}
                  </div>
                  <span className={cn(
                    "text-xs font-mono shrink-0",
                    pe.valor == null ? "text-ink-subtle italic" : pe.contrato ? "text-success-700 font-semibold" : "text-ink-muted",
                  )}>
                    {pe.valor != null ? formatarMoeda(pe.valor) : "—"}
                  </span>
                </button>
              );
            })}
            {/* Cadastro rápido no rodapé do dropdown */}
            {podeCriar && (
              <button
                type="button"
                onClick={() => { setNomeInicial(filtrados.length === 0 ? query.trim() : ""); setAberto(false); setModal(true); }}
                className="sticky bottom-0 w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-primary-600 bg-surface-alt hover:bg-primary-50 border-t border-surface-border"
              >
                <Plus className="w-4 h-4" />
                {filtrados.length === 0 && query.trim()
                  ? `Criar “${query.trim()}”`
                  : catalogo.length === 0 ? "Cadastrar agora" : `Novo ${cadastro!.entidade.singular}`}
              </button>
            )}
          </div>
        )}

      </div>

      {cadastro && (
        <CadastroRapidoModal
          aberto={modal}
          onFechar={() => setModal(false)}
          titulo={`Novo ${cadastro.entidade.singular}`}
          contexto="no catálogo"
          campos={cadastro.campos}
          linkCadastroCompleto={cadastro.link}
          valoresIniciais={nomeInicial ? { nome: nomeInicial } : {}}
          criar={async (v) => {
            const item = await cadastro.criar(v);
            // Já entra no orçamento como item selecionado
            onSelect(item);
            setQuery("");
            return { value: item.id, label: item.nome };
          }}
          onCriado={() => setModal(false)}
        />
      )}

      {/* Alterna entre "só da tabela" e "todos" quando há tabela vinculada */}
      {tabela && (
        <button
          type="button"
          onClick={() => setMostrarTodos((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"
          title={mostrarTodos ? "Mostrar apenas os itens da tabela do cliente" : "Mostrar todos os serviços/produtos cadastrados"}
        >
          {mostrarTodos ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
          {mostrarTodos ? "Mostrar só da tabela" : "Mostrar todos os serviços"}
        </button>
      )}
    </div>
  );
}
