import type { NextRequest, NextResponse } from "next/server";
import { decode, encode, type JWT } from "next-auth/jwt";
import { COOKIE_SESSAO } from "@/lib/sessao-ativa";
import { SESSAO_LONGA_SEG } from "@/lib/acesso/sessao";

/**
 * Regrava o cookie da sessão ATUAL com o token ajustado (ex.: impressão da senha nova depois da troca
 * no perfil). Assim quem trocou a senha continua logado neste aparelho, e as outras sessões — com a
 * impressão antiga — caem. Mesmo formato do Auth.js (JWE com o segredo e o nome do cookie como salt).
 * Devolve false se não havia sessão legível no pedido (nada é gravado).
 */
export async function regravarSessaoAtual(req: NextRequest, res: NextResponse, ajustar: (t: JWT) => JWT): Promise<boolean> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const pedacos = req.cookies.getAll().filter((c) => COOKIE_SESSAO.test(c.name));
  if (!secret || !pedacos.length) return false;
  const nome = pedacos[0].name.replace(/\.\d+$/, "");
  // O Auth.js divide tokens grandes em nome.0, nome.1…; junta na ordem.
  const ordem = (n: string) => Number(/\.(\d+)$/.exec(n)?.[1] ?? -1);
  const valor = pedacos.filter((c) => c.name.replace(/\.\d+$/, "") === nome)
    .sort((a, b) => ordem(a.name) - ordem(b.name)).map((c) => c.value).join("");
  const token = await decode({ token: valor, secret, salt: nome }).catch(() => null);
  if (!token) return false;

  const novo = await encode({ token: ajustar(token as JWT), secret, salt: nome, maxAge: SESSAO_LONGA_SEG });
  for (const p of pedacos) if (p.name !== nome) res.cookies.set(p.name, "", { path: "/", maxAge: 0 });
  res.cookies.set(nome, novo, {
    httpOnly: true, sameSite: "lax", path: "/", secure: nome.startsWith("__Secure-"),
    expires: new Date(Date.now() + SESSAO_LONGA_SEG * 1000),
  });
  return true;
}
