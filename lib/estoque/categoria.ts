/**
 * Categoria de produto (Estoque E3.1) — regras PURAS: a categoria carrega o COMPORTAMENTO DE
 * FATURAMENTO do produto, que o orçamento (E3.3) e a composição do serviço (E3.2) vão ler:
 *  - VENDA_A_PARTE: peça de reposição — cobra do cliente separado e baixa estoque;
 *  - INCLUSO_NO_SERVICO: material de instalação/consumo — embutido no valor do serviço, só baixa estoque.
 * Produto SEM categoria = INCLUSO por padrão: nunca cobra o cliente sozinho sem o Zé definir
 * (o orçamento vai sinalizar isso quando a E3.3 chegar).
 */
export const COMPORTAMENTOS = ["VENDA_A_PARTE", "INCLUSO_NO_SERVICO"] as const;
export type Comportamento = (typeof COMPORTAMENTOS)[number];

export const COMPORTAMENTO_PADRAO: Comportamento = "INCLUSO_NO_SERVICO";

export const LABEL_COMPORTAMENTO: Record<Comportamento, string> = { VENDA_A_PARTE: "Venda à parte", INCLUSO_NO_SERVICO: "Incluso no serviço" };
export const DESCRICAO_COMPORTAMENTO: Record<Comportamento, string> = {
  VENDA_A_PARTE: "Peça de reposição: cobra do cliente separado e baixa o estoque.",
  INCLUSO_NO_SERVICO: "Material de instalação/consumo: embutido no valor do serviço, só baixa o estoque.",
};
/** Opções do select do cadastro (rótulo curto + o que significa) */
export const OPCOES_COMPORTAMENTO = COMPORTAMENTOS.map((value) => ({ value, label: `${LABEL_COMPORTAMENTO[value]} — ${DESCRICAO_COMPORTAMENTO[value]}` }));

export const ehComportamento = (v: unknown): v is Comportamento => (COMPORTAMENTOS as readonly string[]).includes(String(v));

/** As duas categorias de toda empresa (seed idempotente, por empresa) */
export const CATEGORIAS_PADRAO: { nome: string; comportamento: Comportamento }[] = [
  { nome: "Peças de reposição", comportamento: "VENDA_A_PARTE" },
  { nome: "Materiais de instalação/consumo", comportamento: "INCLUSO_NO_SERVICO" },
];

export interface ProdutoComCategoria { categoriaProduto?: { comportamento: string } | null }

/** O comportamento que vale para o produto: o da categoria; sem categoria (ou categoria estranha), INCLUSO. */
export function comportamentoDoProduto(p: ProdutoComCategoria | null | undefined): Comportamento {
  const c = p?.categoriaProduto?.comportamento;
  return ehComportamento(c) ? c : COMPORTAMENTO_PADRAO;
}
/** Cobra do cliente separado? Só quando a categoria diz "Venda à parte". */
export const cobraSeparado = (p: ProdutoComCategoria | null | undefined) => comportamentoDoProduto(p) === "VENDA_A_PARTE";
/** Produto sem categoria: tratado como incluso, mas é um "ainda não definido" (a E3.3 sinaliza no orçamento) */
export const semCategoria = (p: ProdutoComCategoria | null | undefined) => !p?.categoriaProduto;
