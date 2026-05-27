import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { unidadeSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const unidade = await prisma.unidade.findFirst({
    where: { id, empresaId },
    include: { _count: { select: { equipamentos: true } } },
  });
  if (!unidade) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(unidade);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.unidade.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();

  // Se é uma operação de marcar como principal
  if (body._marcarPrincipal) {
    await prisma.$transaction([
      prisma.unidade.updateMany({
        where: { clienteId: existente.clienteId, empresaId, principal: true },
        data: { principal: false },
      }),
      prisma.unidade.update({ where: { id }, data: { principal: true } }),
    ]);
    const atualizado = await prisma.unidade.findUnique({ where: { id } });
    return NextResponse.json(atualizado);
  }

  const parsed = unidadeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const atualizado = await prisma.unidade.update({ where: { id }, data: parsed.data });
  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.unidade.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  if (existente.principal) {
    return NextResponse.json({ erro: "Não é possível remover o endereço principal." }, { status: 409 });
  }

  const equipamentos = await prisma.equipamento.count({ where: { unidadeId: id, ativo: true } });
  if (equipamentos > 0) {
    return NextResponse.json(
      { erro: `Não é possível remover: existem ${equipamentos} equipamento(s) vinculado(s) a este endereço.` },
      { status: 409 }
    );
  }

  await prisma.unidade.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
