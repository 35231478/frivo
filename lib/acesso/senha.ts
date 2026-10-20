/**
 * Regra de senha nova (convite, "esqueci a senha" e troca no perfil): pelo menos 8 caracteres, com
 * letra e número. Pura — usada na tela (lista de requisitos ao vivo) e no servidor (que é quem manda).
 * Senhas antigas mais fracas continuam entrando: a regra vale só para senha NOVA.
 */
export const SENHA_MINIMA = 8;
export const SENHA_MAXIMA = 200;

export const REQUISITOS_SENHA = [
  { id: "tamanho", texto: `Pelo menos ${SENHA_MINIMA} caracteres`, ok: (s: string) => s.length >= SENHA_MINIMA },
  { id: "letra", texto: "Uma letra", ok: (s: string) => /\p{L}/u.test(s) },
  { id: "numero", texto: "Um número", ok: (s: string) => /\d/.test(s) },
] as const;

/** Mensagem do primeiro requisito que falta (ou null se a senha serve). */
export function problemaSenha(senha: string): string | null {
  if (senha.length > SENHA_MAXIMA) return `A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`;
  if (senha.length < SENHA_MINIMA) return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (!/\p{L}/u.test(senha)) return "A senha precisa ter pelo menos uma letra.";
  if (!/\d/.test(senha)) return "A senha precisa ter pelo menos um número.";
  return null;
}
