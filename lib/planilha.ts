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
  /**
   * Realce da linha sob o mouse: o acento bem claro (primary-100 a 60%), um degrau acima da zebra
   * (surface-alt a 60%) para ficar claro em qual linha o mouse está, sem brigar com a identidade.
   * Uma linha com realce próprio (ex.: vencida, vermelha) traz o `hover:` dela depois deste, e o
   * `cn` (tailwind-merge) fica com o dela.
   */
  linhaHover: "hover:bg-primary-100/60",
  /**
   * Linha com a caixa de seleção marcada: fundo do acento claro (primary-50), permanente enquanto
   * marcada, por cima da zebra e da linha vermelha (como o selecionado do Conta Azul); sob o mouse
   * um degrau acima (primary-100). A TabelaPro aplica quando o id da linha está na seleção
   * (components/listagem/selecao-linhas).
   */
  linhaSelecionada: "bg-primary-50 even:bg-primary-50 hover:bg-primary-100",
  td: "px-2 py-1.5 align-top",
  /** Valor em R$ / número: à direita, alinhado pelos algarismos */
  numero: "text-right tabular-nums whitespace-nowrap",
  /** Código/número do registro (orçamento, OS, conta, nota): a MESMA fonte em todas as telas */
  codigo: "font-mono text-[12px] font-semibold",
  /** O nome principal da linha: só peso, nunca tamanho maior que o resto */
  nome: "font-medium text-ink",
  /** Texto secundário (técnico, categoria, datas) */
  apagado: "text-ink-muted",
  /** Data: alinhada pelos algarismos, nunca quebra */
  data: "tabular-nums whitespace-nowrap",
} as const;


/** Valor na planilha (o "R$" fica no cabeçalho da coluna) — o mesmo do documento do orçamento */
export { valorSemMoeda } from "@/lib/orcamentos/proposta";
