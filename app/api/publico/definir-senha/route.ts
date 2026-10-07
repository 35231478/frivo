import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MENSAGEM_ERRO_CONVITE, SENHA_MINIMA, definirSenhaPorConvite, verificarTokenConvite } from "@/lib/usuarios/convite";

/**
 * Pública (fora do login): confere o link do convite (GET) e define a senha (POST).
 * O token é assinado, expira e é de uso único (lib/usuarios/convite.ts).
 */
export async function GET(req: NextRequest) {
  const v = await verificarTokenConvite(req.nextUrl.searchParams.get("token") ?? "");
  if (!v.ok) return NextResponse.json({ erro: MENSAGEM_ERRO_CONVITE[v.erro] }, { status: 400 });
  return NextResponse.json({ nome: v.usuario.nome, email: v.usuario.email });
}

const schema = z.object({
  token: z.string().min(10).max(2000),
  senha: z.string().min(SENHA_MINIMA, `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`).max(200),
  confirmar: z.string(),
}).strict();

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { token, senha, confirmar } = parsed.data;
  if (senha !== confirmar) return NextResponse.json({ erro: "A confirmação não confere com a senha." }, { status: 400 });
  const r = await definirSenhaPorConvite(token, senha);
  if (!r.ok) return NextResponse.json({ erro: MENSAGEM_ERRO_CONVITE[r.erro] }, { status: 400 });
  return NextResponse.json({ ok: true, email: r.usuario.email });
}
