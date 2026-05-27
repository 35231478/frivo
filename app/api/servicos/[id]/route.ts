import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { valorPadrao, ...resto } = body;

  const item = await prisma.servico.update({ where: { id }, data: { ...resto, valorPadrao: valorPadrao ?? null } });
  return NextResponse.json(item);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;

  await prisma.servico.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
