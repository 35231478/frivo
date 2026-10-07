import { NextRequest, NextResponse } from "next/server";
import { COOKIE_SESSAO } from "@/lib/sessao-ativa";

/**
 * Sessão encerrada (usuário inativado, empresa inativa ou sessão inválida): apaga o cookie da
 * sessão do painel e manda para o login. Sem isso, o middleware (que só lê o JWT) veria o cookie
 * antigo e devolveria /login → /dashboard → /login em loop.
 */
export function GET(req: NextRequest) {
  const destino = new URL("/login", req.url);
  destino.searchParams.set("sessao", "encerrada");
  const res = NextResponse.redirect(destino);
  for (const c of req.cookies.getAll()) {
    if (COOKIE_SESSAO.test(c.name)) res.cookies.set(c.name, "", { path: "/", maxAge: 0 });
  }
  return res;
}
