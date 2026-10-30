/**
 * "Cara de planilha" — o estilo ÚNICO das tabelas densas (documento do orçamento, Contas a
 * Receber…): linhas baixas, fios finos entre as linhas, zebrado leve, cabeçalho compacto e
 * valores à direita com números tabulares. Só para o desktop: no celular as listas viram cartões.
 */
export const PLANILHA = {
  tabela: "w-full border-collapse text-[13px] leading-snug",
  /** Linha do cabeçalho (fundo + fio de cima e de baixo) */
  cabecalho: "bg-surface-alt border-y border-ink/15",
  th: "px-2 py-1.5 font-semibold text-ink-muted text-[10px] uppercase tracking-wider",
  linha: "border-b border-surface-linha even:bg-surface-alt/60",
  td: "px-2 py-1.5 align-top",
  /** Valor em R$ / número: à direita, alinhado pelos algarismos */
  numero: "text-right tabular-nums whitespace-nowrap",
} as const;


/** Valor na planilha (o "R$" fica no cabeçalho da coluna) — o mesmo do documento do orçamento */
export { valorSemMoeda } from "@/lib/orcamentos/proposta";
