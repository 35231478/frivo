import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  // Garante isolamento de tenant antes de alterar
  const existente = await prisma.produto.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const { id: _i, empresaId: _e, criadoEm: _c, valorPadrao, estoqueMinimo, ...resto } = body;

  const item = await prisma.produto.update({
    where: { id },
    data: { ...resto, valorPadrao: valorPadrao ?? null, estoqueMinimo: estoqueMinimo ?? null },
  });
  return NextResponse.json(item);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.produto.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.produto.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
