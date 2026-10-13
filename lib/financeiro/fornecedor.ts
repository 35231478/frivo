/**
 * Fornecedor de uma conta a pagar — Leva 5.2: o vínculo é o ID. Puro (sem Prisma): telas e testes.
 */
export interface FornecedorLigado { id: string; nome: string; documento: string | null; ativo: boolean }

export type FornecedorExibido =
  | { id: string; nome: string; documento: string | null; ativo: boolean; semCadastro: false }
  /** Conta antiga cujo texto não casou com nenhum fornecedor: só o texto (e o CNPJ digitado) */
  | { id: null; nome: string; documento: string | null; ativo: true; semCadastro: true };

/** O que mostrar: o fornecedor LIGADO (nome/documento atuais do cadastro); sem vínculo, o texto antigo. */
export function fornecedorDaConta(conta: {
  fornecedorId?: string | null; fornecedor?: string | null; fornecedorCnpj?: string | null; fornecedorCadastro?: FornecedorLigado | null;
}): FornecedorExibido {
  const f = conta.fornecedorId ? conta.fornecedorCadastro : null;
  if (f) return { id: f.id, nome: f.nome, documento: f.documento, ativo: f.ativo, semCadastro: false };
  return { id: null, nome: conta.fornecedor || "—", documento: conta.fornecedorCnpj ?? null, ativo: true, semCadastro: true };
}
