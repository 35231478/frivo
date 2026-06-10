import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { equipeSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const equipe = await prisma.equipe.findFirst({
    where: { id, empresaId },
    include: {
      membros: { select: { id: true, nome: true } },
      veiculos: { select: { id: true } },
    },
  });
  if (!equipe) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
  return NextResponse.json(equipe);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.equipe.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  const body = await req.json();
  const parsed = equipeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { membroIds, veiculoId, liderId, ...rest } = parsed.data;

  const equipe = await prisma.equipe.update({
    where: { id },
    data: {
      ...rest,
      liderId: liderId || null,
      membros: { set: membroIds.map((mid) => ({ id: mid })) },
    },
  });

  // Veículo vinculado: garante vínculo único — limpa os atuais e define o escolhido
  await prisma.veiculo.updateMany({ where: { empresaId, equipeId: id }, data: { equipeId: null } });
  if (veiculoId) {
    await prisma.veiculo.updateMany({ where: { id: veiculoId, empresaId }, data: { equipeId: id } });
  }

  return NextResponse.json(equipe);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.equipe.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  await prisma.veiculo.updateMany({ where: { empresaId, equipeId: id }, data: { equipeId: null } });
  await prisma.equipe.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
