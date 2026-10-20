import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { definirSenhaPorConvite, mensagemErroLink, verificarTokenConvite } from "@/lib/usuarios/convite";
import { problemaSenha } from "@/lib/acesso/senha";

/**
 * Pública (fora do login): confere o link (GET) e define a senha (POST). Serve ao convite de usuário
 * e ao "Esqueci minha senha". O token é assinado, expira e é de uso único (lib/usuarios/convite.ts).
 */
export async function GET(req: NextRequest) {
  const v = await verificarTokenConvite(req.nextUrl.searchParams.get("token") ?? "");
  if (!v.ok) return NextResponse.json({ erro: mensagemErroLink(v.erro, v.finalidade), finalidade: v.finalidade }, { status: 400 });
  return NextResponse.json({ nome: v.usuario.nome, email: v.usuario.email, finalidade: v.finalidade });
}

const schema = z.object({
  token: z.string().min(10).max(2000),
  senha: z.string().superRefine((s, ctx) => { const p = problemaSenha(s); if (p) ctx.addIssue({ code: "custom", message: p }); }),
  confirmar: z.string(),
}).strict();

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { token, senha, confirmar } = parsed.data;
  if (senha !== confirmar) return NextResponse.json({ erro: "A confirmação não confere com a senha." }, { status: 400 });
  const r = await definirSenhaPorConvite(token, senha);
  if (!r.ok) return NextResponse.json({ erro: mensagemErroLink(r.erro, r.finalidade) }, { status: 400 });
  return NextResponse.json({ ok: true, email: r.usuario.email });
}
