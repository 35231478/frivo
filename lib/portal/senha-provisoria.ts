/**
 * PORTAL DO CLIENTE: senha provisória segura e troca obrigatória no 1º acesso (regra pura, sem banco).
 *
 *  - A senha provisória é GERADA pelo sistema (a equipe não digita senha de ninguém): mostrada UMA vez a
 *    quem liberou o acesso, para repassar; no banco fica só o hash.
 *  - Com a senha vinda da equipe (`trocarSenha`), o contato entra e só vê a tela de troca até criar a própria.
 *  - Sem ciclo: a tela de troca nunca manda para o painel do portal enquanto a troca estiver pendente, e o
 *    painel só manda para a troca (o login decide uma vez, pelo mesmo critério).
 * Sem nada de servidor: as telas importam daqui (o gerador fica em lib/portal/gerar-senha).
 */
export const ROTA_TROCA_PORTAL = "/portal/trocar-senha";
export const API_TROCA_PORTAL = "/api/portal/senha";
export const ROTA_INICIO_PORTAL = "/portal/dashboard";
export const MSG_TROCA_PENDENTE_PORTAL = "Crie a sua senha para continuar.";

/** Sem caracteres que se confundem ao ditar ou ler (0/O, 1/l/I). */
export const ALFABETO_SENHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const DIGITOS_SENHA = "23456789";
export const TAMANHO_SENHA_PROVISORIA = 12;

/** A troca está pendente para esta sessão do portal? */
export const trocaPendentePortal = (user: unknown): boolean =>
  !!user && typeof user === "object" && (user as { trocarSenha?: unknown }).trocarSenha === true;

/** Para onde vai quem JÁ está logado e abre o login (ou a tela de troca): uma decisão só, sem ciclo. */
export function destinoDoPortal(user: unknown, pedido?: string | null): string {
  return trocaPendentePortal(user) ? ROTA_TROCA_PORTAL : destinoSeguroDoPortal(pedido) ?? ROTA_INICIO_PORTAL;
}

/**
 * O "voltar para onde ia" depois do login do portal (ex.: o link do e-mail de lembrete): só uma rota interna do
 * portal — nada de outro site ("//", "\\", "http"), nem as telas de entrar/trocar. Fora disso, null.
 */
export function destinoSeguroDoPortal(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 200) return null;
  if (!/^\/portal\/[a-z0-9\-/]*$/i.test(v) || v.includes("//")) return null;
  if (/^\/portal\/(login|trocar-senha|esqueci-senha|definir-senha)/.test(v)) return null;
  return v;
}

/** O link que leva ao login do portal e, depois de entrar, à rota pedida */
export const linkDoPortal = (base: string, rota: string) => `${base}/portal/login?destino=${encodeURIComponent(rota)}`;

/** A mensagem que vai junto da senha (e-mail e WhatsApp): o contato sabe que vai trocar no 1º acesso. */
export function mensagemDoAcesso(d: { contatoNome: string; link: string; email: string; senha: string | null }): string {
  return `Prezado(a) ${d.contatoNome}, seu acesso ao portal do cliente está pronto.\n` +
    `Acesse: ${d.link}\nE-mail: ${d.email}` +
    (d.senha ? `\nSenha provisória: ${d.senha}\nNo primeiro acesso, o portal pede para criar uma senha própria.` : "");
}
