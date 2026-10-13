/**
 * Categoria financeira de uma conta (a receber / a pagar) — Leva 5.1: o vínculo é o ID.
 * Puro (sem Prisma): usado pelas telas, pela exportação e pelos testes.
 */
export interface CategoriaFinanceiraOpcao { id: string; nome: string; cor: string; ativo: boolean }

export const COR_SEM_CATEGORIA = "#64748B";

export type CategoriaExibida =
  | { id: string; nome: string; cor: string; ativo: boolean; semCadastro: false }
  /** Conta antiga cujo nome não casou com nenhuma categoria na migração: só o texto */
  | { id: null; nome: string; cor: string; ativo: true; semCadastro: true };

/**
 * O que mostrar: a categoria LIGADA (nome e cor atuais — renomear a categoria não desliga a conta);
 * sem vínculo, o texto antigo gravado na conta; sem nada, null.
 */
export function categoriaDaConta(
  conta: { categoriaId?: string | null; categoria?: string | null },
  categorias: readonly CategoriaFinanceiraOpcao[],
): CategoriaExibida | null {
  const cat = conta.categoriaId ? categorias.find((c) => c.id === conta.categoriaId) : undefined;
  if (cat) return { id: cat.id, nome: cat.nome, cor: cat.cor || COR_SEM_CATEGORIA, ativo: cat.ativo, semCadastro: false };
  if (conta.categoria) return { id: null, nome: conta.categoria, cor: COR_SEM_CATEGORIA, ativo: true, semCadastro: true };
  return null;
}
