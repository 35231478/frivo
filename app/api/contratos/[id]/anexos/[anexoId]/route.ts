import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; anexoId: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoContrato.findFirst({ where: { id: anexoId, contratoId: id, empresaId } });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  return NextResponse.json(anexo);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoContrato.findFirst({ where: { id: anexoId, contratoId: id, empresaId } });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  await prisma.anexoContrato.delete({ where: { id: anexoId } });
  return NextResponse.json({ ok: true });
}
