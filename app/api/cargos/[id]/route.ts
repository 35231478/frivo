import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const cargoUpdateSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório").optional(),
  descricao: z.string().optional(),
  ativo: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.cargo.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Cargo não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = cargoUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const cargo = await prisma.cargo.update({ where: { id }, data: parsed.data });
  return NextResponse.json(cargo);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.cargo.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Cargo não encontrado" }, { status: 404 });

  await prisma.cargo.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
