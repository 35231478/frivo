import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.tipoProblema.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.nome === "string") data.nome = body.nome;
  if (typeof body.ativo === "boolean") data.ativo = body.ativo;

  const item = await prisma.tipoProblema.update({ where: { id }, data });
  return NextResponse.json(item);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.tipoProblema.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.tipoProblema.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
