import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  senhaAtual: z.string().min(1, "Informe a senha atual"),
  novaSenha: z.string().min(8, "A nova senha deve ter no mínimo 8 caracteres"),
  confirmar: z.string().min(1, "Confirme a nova senha"),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const userId = session.user.id;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { senhaAtual, novaSenha, confirmar } = parsed.data;

  if (novaSenha !== confirmar) {
    return NextResponse.json({ erro: "A confirmação da nova senha não coincide." }, { status: 400 });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: userId }, select: { senha: true } });
  if (!usuario) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

  const ok = await bcrypt.compare(senhaAtual, usuario.senha);
  if (!ok) return NextResponse.json({ erro: "Senha atual incorreta." }, { status: 400 });

  const hash = await bcrypt.hash(novaSenha, 10);
  await prisma.usuario.update({ where: { id: userId }, data: { senha: hash } });

  return NextResponse.json({ ok: true });
}
