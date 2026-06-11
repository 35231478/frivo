import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório").optional(),
  email: z.string().trim().email("E-mail inválido").optional(),
  confirmacaoEmail: z.string().trim().email().optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const userId = session.user.id;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { nome, email, confirmacaoEmail } = parsed.data;

  const atual = await prisma.usuario.findUnique({ where: { id: userId }, select: { email: true } });
  if (!atual) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

  const data: { nome?: string; email?: string } = {};
  if (nome) data.nome = nome;

  if (email && email.toLowerCase() !== atual.email.toLowerCase()) {
    if (confirmacaoEmail !== email) {
      return NextResponse.json({ erro: "A confirmação de e-mail não coincide." }, { status: 400 });
    }
    const emUso = await prisma.usuario.findFirst({
      where: { email, id: { not: userId } },
      select: { id: true },
    });
    if (emUso) return NextResponse.json({ erro: "Este e-mail já está em uso por outro usuário." }, { status: 409 });
    data.email = email;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ erro: "Nenhuma alteração informada." }, { status: 400 });
  }

  const atualizado = await prisma.usuario.update({
    where: { id: userId },
    data,
    select: { nome: true, email: true },
  });
  return NextResponse.json(atualizado);
}
