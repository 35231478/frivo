import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contatoClienteSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string; contatoId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contatoCliente.findFirst({
    where: { id: contatoId, clienteId: id, empresaId },
  });
  if (!existente) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = contatoClienteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  }

  const atualizado = await prisma.contatoCliente.update({
    where: { id: contatoId },
    data: parsed.data,
  });

  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contatoCliente.findFirst({
    where: { id: contatoId, clienteId: id, empresaId },
  });
  if (!existente) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  await prisma.contatoCliente.update({ where: { id: contatoId }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
