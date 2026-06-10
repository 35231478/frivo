import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { veiculoSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const veiculo = await prisma.veiculo.findFirst({
    where: { id, empresaId },
    include: {
      documentos: { orderBy: { criadoEm: "asc" } },
      manutencoes: { orderBy: { dataRealizacao: "desc" } },
    },
  });
  if (!veiculo) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(veiculo);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.veiculo.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = veiculoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const placa = parsed.data.placa.toUpperCase().trim();
  if (placa !== existente.placa) {
    const dup = await prisma.veiculo.findFirst({ where: { empresaId, placa } });
    if (dup) return NextResponse.json({ erro: "Placa já cadastrada" }, { status: 409 });
  }

  const { documentos, responsavelId, equipeId, proximaRevisaoData, seguroVencimento, ...rest } = parsed.data;

  const veiculo = await prisma.veiculo.update({
    where: { id },
    data: {
      ...rest,
      placa,
      responsavelId: responsavelId || null,
      equipeId: equipeId || null,
      proximaRevisaoData: proximaRevisaoData ? new Date(proximaRevisaoData) : null,
      seguroVencimento: seguroVencimento ? new Date(seguroVencimento) : null,
      documentos: {
        deleteMany: {},
        create: documentos.map((d) => ({
          tipo: d.tipo,
          nome: d.nome,
          arquivoUrl: d.arquivoUrl || null,
          dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null,
        })),
      },
    },
  });

  return NextResponse.json(veiculo);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.veiculo.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.veiculo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
