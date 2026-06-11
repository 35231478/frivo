import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

const equipSelect = {
  id: true,
  feito: true,
  feitoEm: true,
  equipamento: {
    select: {
      id: true, nome: true, marca: true, modelo: true, numeroSerie: true,
      localizacao: true, tipo: true, tipoEquipamentoId: true,
      tipoEquipamento: { select: { id: true, nome: true } },
    },
  },
} as const;

async function getAtividade(empresaId: string, id: string, atividadeId: string) {
  return prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: id, empresaId },
    select: { id: true },
  });
}

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  if (!(await getAtividade(empresaId, id, atividadeId))) {
    return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });
  }

  const itens = await prisma.atividadeEquipamento.findMany({
    where: { atividadeId },
    select: equipSelect,
    orderBy: { criadoEm: "asc" },
  });
  return NextResponse.json(itens);
}

const postSchema = z.object({ equipamentoIds: z.array(z.string().min(1)).min(1) });

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  if (!(await getAtividade(empresaId, id, atividadeId))) {
    return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });
  }

  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  // Só equipamentos da própria empresa
  const validos = await prisma.equipamento.findMany({
    where: { id: { in: parsed.data.equipamentoIds }, empresaId },
    select: { id: true },
  });

  if (validos.length > 0) {
    await prisma.atividadeEquipamento.createMany({
      data: validos.map((e) => ({ atividadeId, equipamentoId: e.id })),
      skipDuplicates: true,
    });
  }

  const itens = await prisma.atividadeEquipamento.findMany({
    where: { atividadeId },
    select: equipSelect,
    orderBy: { criadoEm: "asc" },
  });
  return NextResponse.json(itens, { status: 201 });
}
