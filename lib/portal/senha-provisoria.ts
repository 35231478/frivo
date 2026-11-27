/**
 * PORTAL DO CLIENTE: senha provisória segura e troca obrigatória no 1º acesso (regra pura, sem banco).
 *
 *  - A senha provisória é GERADA pelo sistema (a equipe não digita senha de ninguém): mostrada UMA vez a
 *    quem liberou o acesso, para repassar; no banco fica só o hash.
 *  - Com a senha vinda da equipe (`trocarSenha`), o contato entra e só vê a tela de troca até criar a própria.
 *  - Sem ciclo: a tela de troca nunca manda para o painel do portal enquanto a troca estiver pendente, e o
 *    painel só manda para a troca (o login decide uma vez, pelo mesmo critério).
 */
import { randomInt } from "node:crypto";

export const ROTA_TROCA_PORTAL = "/portal/trocar-senha";
export const API_TROCA_PORTAL = "/api/portal/senha";
export const ROTA_INICIO_PORTAL = "/portal/dashboard";
export const MSG_TROCA_PENDENTE_PORTAL = "Crie a sua senha para continuar.";

/** Sem caracteres que se confundem ao ditar ou ler (0/O, 1/l/I). */
export const ALFABETO_SENHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const DIGITOS = "23456789";
export const TAMANHO_SENHA_PROVISORIA = 12;

/**
 * Senha provisória com gerador criptográfico: 12 caracteres do alfabeto sem ambíguos, com pelo menos uma
 * letra e um número (passa na mesma regra das senhas novas). `sortear` só é trocado nos testes.
 */
export function gerarSenhaProvisoria(sortear: (n: number) => number = randomInt): string {
  const s = Array.from({ length: TAMANHO_SENHA_PROVISORIA }, () => ALFABETO_SENHA[sortear(ALFABETO_SENHA.length)]);
  if (!s.some((c) => DIGITOS.includes(c))) s[sortear(s.length)] = DIGITOS[sortear(DIGITOS.length)];
  if (!s.some((c) => /[A-Za-z]/.test(c))) s[sortear(s.length)] = ALFABETO_SENHA[sortear(48)]; // as 48 primeiras são letras
  return s.join("");
}

/** A troca está pendente para esta sessão do portal? */
export const trocaPendentePortal = (user: unknown): boolean =>
  !!user && typeof user === "object" && (user as { trocarSenha?: unknown }).trocarSenha === true;

/** Para onde vai quem JÁ está logado e abre o login (ou a tela de troca): uma decisão só, sem ciclo. */
export function destinoDoPortal(user: unknown): string {
  return trocaPendentePortal(user) ? ROTA_TROCA_PORTAL : ROTA_INICIO_PORTAL;
}

/** A mensagem que vai junto da senha (e-mail e WhatsApp): o contato sabe que vai trocar no 1º acesso. */
export function mensagemDoAcesso(d: { contatoNome: string; link: string; email: string; senha: string | null }): string {
  return `Prezado(a) ${d.contatoNome}, seu acesso ao portal do cliente está pronto.\n` +
    `Acesse: ${d.link}\nE-mail: ${d.email}` +
    (d.senha ? `\nSenha provisória: ${d.senha}\nNo primeiro acesso, o portal pede para criar uma senha própria.` : "");
}
