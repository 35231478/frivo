/**
 * Custo na OS — o custo dos materiais (último custo de compra copiado em os_materiais.custo_unit) segue a regra
 * única do custo de compra (lib/estoque/custo-acesso): quem não pode ver NÃO recebe o campo (as rotas e a página
 * tiram a chave com `semCustoNosItensOs`), e o salvar NUNCA confia no custo vindo do navegador.
 */
import { semCustoNosServicos } from "@/lib/orcamentos/estoque-margem";

/** Tira `custoUnit` dos materiais de cada item da OS (a chave some, não vira null). */
export const semCustoNosItensOs = semCustoNosServicos;

/**
 * O custo que o SERVIDOR grava para um material do item da OS. A tela manda o item inteiro (sem o id dos materiais),
 * então o casamento é pelo produto:
 *  - produto que já estava neste item: mantém o custo copiado quando entrou (não sobe sozinho com compra nova);
 *  - produto novo no item: o último custo de compra de agora;
 *  - material digitado à mão (sem produto): sem custo.
 */
export function custoDoMaterialOs(
  m: { produtoId?: string | null },
  gravadosPorProduto: ReadonlyMap<string, number | null>,
  ultimos: ReadonlyMap<string, number>,
): number | null {
  if (!m.produtoId) return null;
  if (gravadosPorProduto.has(m.produtoId)) return gravadosPorProduto.get(m.produtoId) ?? null;
  return ultimos.get(m.produtoId) ?? null;
}
