/**
 * Categoria de produto (Estoque E3.1) — regras PURAS: a categoria carrega o COMPORTAMENTO DE
 * FATURAMENTO do produto, que o orçamento (E3.3) e a composição do serviço (E3.2) vão ler:
 *  - VENDA_A_PARTE: peça de reposição — cobra do cliente separado e baixa estoque;
 *  - INCLUSO_NO_SERVICO: material de instalação/consumo — embutido no valor do serviço, só baixa estoque.
 * Produto SEM categoria = INCLUSO por padrão: nunca cobra o cliente sozinho sem o Zé definir.
 *
 * "Orçamento E": o comportamento passou a vir do USO do próprio produto (Material = incluso, Peça = à parte),
 * e os termos na tela são só "Material" e "Peça". A categoria fica como sugestão do Uso de um produto novo.
 */
export const COMPORTAMENTOS = ["VENDA_A_PARTE", "INCLUSO_NO_SERVICO"] as const;
export type Comportamento = (typeof COMPORTAMENTOS)[number];

export const COMPORTAMENTO_PADRAO: Comportamento = "INCLUSO_NO_SERVICO";

/** Termos únicos ("Orçamento E"): Material (vai dentro do serviço) e Peça (vendida à parte) */
export const LABEL_COMPORTAMENTO: Record<Comportamento, string> = { VENDA_A_PARTE: "Peça", INCLUSO_NO_SERVICO: "Material" };
export const DESCRICAO_COMPORTAMENTO: Record<Comportamento, string> = {
  VENDA_A_PARTE: "Vendida à parte, em linha própria com valor (compressor, placa, motor, capacitor).",
  INCLUSO_NO_SERVICO: "Consumo do serviço (tubo, suporte, cabo, fita, isolamento): entra no valor do serviço ou é cobrado à parte, conforme Configurações › Orçamento.",
};
/** Opções do select do cadastro (rótulo curto + o que significa) */
export const OPCOES_COMPORTAMENTO = COMPORTAMENTOS.map((value) => ({ value, label: `${LABEL_COMPORTAMENTO[value]} — ${DESCRICAO_COMPORTAMENTO[value]}` }));

export const ehComportamento = (v: unknown): v is Comportamento => (COMPORTAMENTOS as readonly string[]).includes(String(v));

/** As duas categorias de toda empresa (seed idempotente, por empresa) */
export const CATEGORIAS_PADRAO: { nome: string; comportamento: Comportamento }[] = [
  { nome: "Peças de reposição", comportamento: "VENDA_A_PARTE" },
  { nome: "Materiais de instalação/consumo", comportamento: "INCLUSO_NO_SERVICO" },
];

/* ───────── "Orçamento E": o USO do produto (MATERIAL | PECA) — é ele que decide, não mais a categoria ───────── */
export const USOS = ["MATERIAL", "PECA"] as const;
export type Uso = (typeof USOS)[number];
export const USO_PADRAO: Uso = "MATERIAL";
export const LABEL_USO: Record<Uso, string> = { MATERIAL: "Material", PECA: "Peça" };
export const ehUso = (v: unknown): v is Uso => (USOS as readonly string[]).includes(String(v));
/** Uso → comportamento no orçamento/OS (o snapshot do material guarda o comportamento) */
export const comportamentoDoUso = (u: Uso): Comportamento => (u === "PECA" ? "VENDA_A_PARTE" : "INCLUSO_NO_SERVICO");
export const usoDoComportamento = (c: Comportamento): Uso => (c === "VENDA_A_PARTE" ? "PECA" : "MATERIAL");
/** O Uso que um produto NOVO recebe quando o cadastro não diz: o que a categoria sugere; sem categoria, Material */
export const usoSugeridoPelaCategoria = (comportamentoDaCategoria: unknown): Uso =>
  ehComportamento(comportamentoDaCategoria) ? usoDoComportamento(comportamentoDaCategoria) : USO_PADRAO;
/** Opções do select do cadastro: rótulo + o que significa */
export const OPCOES_USO = USOS.map((value) => ({ value, label: `${LABEL_USO[value]} — ${DESCRICAO_COMPORTAMENTO[comportamentoDoUso(value)]}` }));

export interface ProdutoComCategoria { uso?: string | null; categoriaProduto?: { comportamento: string } | null }

/**
 * O comportamento que vale para o produto: o do USO dele ("Orçamento E"); produto lido sem o Uso (dado antigo) cai
 * na categoria; sem nenhum dos dois, Material (incluso).
 */
export function comportamentoDoProduto(p: ProdutoComCategoria | null | undefined): Comportamento {
  if (ehUso(p?.uso)) return comportamentoDoUso(p.uso);
  const c = p?.categoriaProduto?.comportamento;
  return ehComportamento(c) ? c : COMPORTAMENTO_PADRAO;
}
/** Cobra do cliente separado? Só a Peça. */
export const cobraSeparado = (p: ProdutoComCategoria | null | undefined) => comportamentoDoProduto(p) === "VENDA_A_PARTE";
/** Produto sem categoria: tratado como incluso, mas é um "ainda não definido" (a E3.3 sinaliza no orçamento) */
export const semCategoria = (p: ProdutoComCategoria | null | undefined) => !p?.categoriaProduto;
