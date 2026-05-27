import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tecnicoSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = (session.user as any).empresaId as string;

  const tecnico = await prisma.tecnico.findFirst({ where: { id, empresaId } });
  if (!tecnico) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(tecnico);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = (session.user as any).empresaId as string;

  const existente = await prisma.tecnico.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = tecnicoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.cpf !== existente.cpf) {
    const dup = await prisma.tecnico.findUnique({
      where: { cpf_empresaId: { cpf: parsed.data.cpf, empresaId } },
    });
    if (dup) return NextResponse.json({ erro: "CPF já cadastrado" }, { status: 409 });
  }

  const atualizado = await prisma.tecnico.update({ where: { id }, data: parsed.data });
  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = (session.user as any).empresaId as string;

  const existente = await prisma.tecnico.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.tecnico.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
