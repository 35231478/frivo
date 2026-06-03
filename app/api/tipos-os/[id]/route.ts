import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const tipoOsUpdateSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório").optional(),
  descricao: z.string().optional(),
  cor: z.string().optional(),
  ativo: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.tipoOs.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Tipo de OS não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = tipoOsUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const tipo = await prisma.tipoOs.update({ where: { id }, data: parsed.data });
  return NextResponse.json(tipo);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.tipoOs.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Tipo de OS não encontrado" }, { status: 404 });

  await prisma.tipoOs.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
