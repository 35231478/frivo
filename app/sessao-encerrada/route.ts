import { NextRequest, NextResponse } from "next/server";
import { apagarCookiesDaSessao } from "@/lib/acesso/cookie-sessao";
import { lerTokenDoPedido } from "@/lib/acesso/sessao-cookie";
import { motivoDoToken } from "@/lib/sessao-ativa";

/**
 * Sessão encerrada (usuário inativado, empresa inativa, senha trocada, outro aparelho no app de campo):
 * apaga o cookie da sessão do painel e manda para o login com `?sessao=encerrada` (e o motivo, quando é
 * o outro aparelho, para a mensagem).
 *
 * O cookie é apagado com os atributos do Auth.js — `Secure` no nome `__Secure-` —, todos os pedaços. Antes
 * ia sem `Secure`, o navegador recusava, o cookie ficava e o middleware fazia /login → /dashboard →
 * /sessao-encerrada → /login em loop (ERR_TOO_MANY_REDIRECTS). O `?sessao=encerrada` também trava o
 * ciclo no middleware (lib/acesso/cookie-sessao › loginAposEncerrar).
 */
export async function GET(req: NextRequest) {
  const destino = new URL("/login", req.url);
  destino.searchParams.set("sessao", "encerrada");
  const lido = await lerTokenDoPedido(req);
  if ((await motivoDoToken(lido?.token ?? null)) === "outro-aparelho") destino.searchParams.set("motivo", "outro-aparelho");
  const res = NextResponse.redirect(destino);
  apagarCookiesDaSessao(res, req.cookies.getAll().map((c) => c.name));
  return res;
}
