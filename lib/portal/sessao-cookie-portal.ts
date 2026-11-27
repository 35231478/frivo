import type { NextRequest, NextResponse } from "next/server";
import { decode, encode, type JWT } from "next-auth/jwt";

/**
 * O cookie da sessão do PORTAL (separado do painel). Um lugar só para o nome e os atributos: o Auth.js
 * do portal grava com eles (lib/auth-portal) e quem regrava ou apaga usa OS MESMOS. Lição do #270: o
 * navegador recusa um Set-Cookie de nome `__Secure-…` sem `Secure` (o cookie velho ficava e o ciclo de
 * redirecionamento começava). Aqui o `Secure` vai sempre em produção e sempre que o nome tiver o prefixo.
 */
export const COOKIE_PORTAL = "frivo.portal-session-token";
export const COOKIE_PORTAL_RE = /^(__Secure-)?frivo\.portal-session-token(\.\d+)?$/;
export const SESSAO_PORTAL_SEG = 30 * 24 * 60 * 60; // o padrão do Auth.js (30 dias)

export function atributosCookiePortal(nome: string = COOKIE_PORTAL) {
  return { httpOnly: true, sameSite: "lax" as const, path: "/", secure: nome.startsWith("__Secure-") || process.env.NODE_ENV === "production" };
}

const segredo = () => process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
const base = (n: string) => n.replace(/\.\d+$/, "");
type ComCookies = { cookies: { set: (nome: string, valor: string, opcoes: Record<string, unknown>) => unknown } };

/** Apaga na resposta todos os pedaços do cookie do portal que vieram no pedido (e o nome base), com os atributos certos. */
export function apagarCookiePortal(res: ComCookies, nomesNoPedido: string[]): string[] {
  const alvo = new Set<string>();
  for (const n of nomesNoPedido) if (COOKIE_PORTAL_RE.test(n)) { alvo.add(n); alvo.add(base(n)); }
  for (const n of alvo) res.cookies.set(n, "", { ...atributosCookiePortal(n), maxAge: 0, expires: new Date(0) });
  return [...alvo].sort();
}

/** O token do portal que veio no pedido (pedaços juntos na ordem). null = sem sessão legível. */
export async function lerTokenPortal(req: NextRequest): Promise<{ nome: string; token: JWT } | null> {
  const secret = segredo();
  const pedacos = req.cookies.getAll().filter((c) => COOKIE_PORTAL_RE.test(c.name));
  if (!secret || !pedacos.length) return null;
  const nome = base(pedacos[0].name);
  const ordem = (n: string) => Number(/\.(\d+)$/.exec(n)?.[1] ?? -1);
  const valor = pedacos.filter((c) => base(c.name) === nome).sort((a, b) => ordem(a.name) - ordem(b.name)).map((c) => c.value).join("");
  const token = await decode({ token: valor, secret, salt: nome }).catch(() => null);
  return token ? { nome, token: token as JWT } : null;
}

/**
 * Regrava o cookie da sessão ATUAL do portal com o token ajustado (a senha nova e a troca feita): quem trocou
 * continua logado neste aparelho e as outras sessões (com a senha recebida) caem. Os pedaços antigos são
 * apagados. Devolve false se não havia sessão legível (nada é gravado).
 */
export async function regravarSessaoPortal(req: NextRequest, res: NextResponse, ajustar: (t: JWT) => JWT): Promise<boolean> {
  const atual = await lerTokenPortal(req);
  if (!atual) return false;
  const { nome, token } = atual;
  const novo = await encode({ token: ajustar(token), secret: segredo()!, salt: nome, maxAge: SESSAO_PORTAL_SEG });
  apagarCookiePortal(res, req.cookies.getAll().map((c) => c.name).filter((n) => n !== nome));
  res.cookies.set(nome, novo, { ...atributosCookiePortal(nome), expires: new Date(Date.now() + SESSAO_PORTAL_SEG * 1000) });
  return true;
}
