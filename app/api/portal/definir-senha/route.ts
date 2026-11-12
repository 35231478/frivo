import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { problemaSenha, SENHA_MAXIMA } from "@/lib/acesso/senha";
import { definirSenhaPortal, MENSAGEM_ERRO_TOKEN_PORTAL } from "@/lib/portal/recuperacao";

/** Pública: define a nova senha do contato do portal pelo link assinado (uso único). */
const schema = z.object({ token: z.string().min(1).max(2000), senha: z.string().max(SENHA_MAXIMA) }).strict();

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const { token, senha } = parsed.data;

  const problema = problemaSenha(senha);
  if (problema) return NextResponse.json({ erro: problema }, { status: 400 });

  const r = await definirSenhaPortal(token, senha);
  if (!r.ok) return NextResponse.json({ erro: MENSAGEM_ERRO_TOKEN_PORTAL[r.erro] }, { status: 400 });
  return NextResponse.json({ ok: true });
}
