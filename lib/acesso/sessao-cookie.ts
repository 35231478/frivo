import type { NextRequest, NextResponse } from "next/server";
import { decode, encode, type JWT } from "next-auth/jwt";
import { COOKIE_SESSAO, apagarCookiesDaSessao, atributosDaSessao, nomeBaseDaSessao } from "@/lib/acesso/cookie-sessao";
import { SESSAO_LONGA_SEG } from "@/lib/acesso/sessao";

const segredo = () => process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

/**
 * O token da sessão que veio no pedido (o Auth.js divide tokens grandes em nome.0, nome.1…: junta na
 * ordem). Mesmo formato do Auth.js (JWE com o segredo e o nome do cookie como salt). null = sem sessão
 * legível (sem cookie, sem segredo, token adulterado ou de outro segredo).
 */
export async function lerTokenDoPedido(req: NextRequest): Promise<{ nome: string; token: JWT } | null> {
  const secret = segredo();
  const pedacos = req.cookies.getAll().filter((c) => COOKIE_SESSAO.test(c.name));
  if (!secret || !pedacos.length) return null;
  const nome = nomeBaseDaSessao(pedacos[0].name);
  const ordem = (n: string) => Number(/\.(\d+)$/.exec(n)?.[1] ?? -1);
  const valor = pedacos.filter((c) => nomeBaseDaSessao(c.name) === nome)
    .sort((a, b) => ordem(a.name) - ordem(b.name)).map((c) => c.value).join("");
  const token = await decode({ token: valor, secret, salt: nome }).catch(() => null);
  return token ? { nome, token: token as JWT } : null;
}

/**
 * Regrava o cookie da sessão ATUAL com o token ajustado (ex.: impressão da senha nova depois da troca
 * no perfil). Assim quem trocou a senha continua logado neste aparelho, e as outras sessões — com a
 * impressão antiga — caem. Devolve false se não havia sessão legível no pedido (nada é gravado).
 *
 * Os pedaços antigos são apagados e o novo é gravado com os atributos do Auth.js (lib/acesso/cookie-sessao):
 * sem `Secure`, o navegador recusaria o Set-Cookie de nome `__Secure-…`.
 */
export async function regravarSessaoAtual(req: NextRequest, res: NextResponse, ajustar: (t: JWT) => JWT): Promise<boolean> {
  const atual = await lerTokenDoPedido(req);
  if (!atual) return false;
  const { nome, token } = atual;
  const novo = await encode({ token: ajustar(token), secret: segredo()!, salt: nome, maxAge: SESSAO_LONGA_SEG });
  apagarCookiesDaSessao(res, req.cookies.getAll().map((c) => c.name).filter((n) => n !== nome));
  res.cookies.set(nome, novo, { ...atributosDaSessao(nome), expires: new Date(Date.now() + SESSAO_LONGA_SEG * 1000) });
  return true;
}
