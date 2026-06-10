import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { equipeSchema } from "@/lib/validations";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const equipes = await prisma.equipe.findMany({
    where: { empresaId },
    include: {
      lider: { select: { id: true, nome: true, avatar: true } },
      membros: { select: { id: true, nome: true, avatar: true } },
      veiculos: { select: { id: true, placa: true, modelo: true } },
    },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(equipes);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = equipeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { membroIds, veiculoId, liderId, ...rest } = parsed.data;

  const equipe = await prisma.equipe.create({
    data: {
      ...rest,
      empresaId,
      liderId: liderId || null,
      membros: { connect: membroIds.map((id) => ({ id })) },
    },
  });

  if (veiculoId) {
    await prisma.veiculo.updateMany({ where: { id: veiculoId, empresaId }, data: { equipeId: equipe.id } });
  }

  return NextResponse.json(equipe, { status: 201 });
}
