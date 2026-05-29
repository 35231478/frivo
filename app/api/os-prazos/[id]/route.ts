import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const prazo = await prisma.osPrazo.findFirst({ where: { id, ordemServico: { empresaId } } });
  if (!prazo) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.osPrazo.update({ where: { id }, data: { status: "CANCELADO" } });
  return NextResponse.json({ ok: true });
}
