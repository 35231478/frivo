/**
 * Contato do cliente sem os segredos do portal. O hash (`senha`) e a antiga senha em texto
 * (`senhaProvisoria`) nunca saem do servidor: a tela só precisa saber se há acesso.
 */
export type ContatoSeguro<T> = Omit<T, "senha" | "senhaProvisoria"> & { temAcesso: boolean };

export function contatoSeguro<T extends { senha?: string | null; senhaProvisoria?: string | null }>(
  contato: T,
): ContatoSeguro<T> {
  const { senha, senhaProvisoria: _senhaProvisoria, ...resto } = contato;
  return { ...resto, temAcesso: !!senha };
}
