import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { veiculoSchema } from "@/lib/validations";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const veiculos = await prisma.veiculo.findMany({
    where: { empresaId },
    include: {
      responsavel: { select: { id: true, nome: true } },
      equipe: { select: { id: true, nome: true, cor: true } },
      _count: { select: { manutencoes: true, checklists: true } },
    },
    orderBy: { placa: "asc" },
  });

  return NextResponse.json(veiculos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = veiculoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const placa = parsed.data.placa.toUpperCase().trim();
  const existente = await prisma.veiculo.findFirst({ where: { empresaId, placa } });
  if (existente) return NextResponse.json({ erro: "Placa já cadastrada" }, { status: 409 });

  const { documentos, responsavelId, equipeId, proximaRevisaoData, seguroVencimento, ...rest } = parsed.data;

  const veiculo = await prisma.veiculo.create({
    data: {
      ...rest,
      placa,
      empresaId,
      responsavelId: responsavelId || null,
      equipeId: equipeId || null,
      proximaRevisaoData: proximaRevisaoData ? new Date(proximaRevisaoData) : null,
      seguroVencimento: seguroVencimento ? new Date(seguroVencimento) : null,
      documentos: {
        create: documentos.map((d) => ({
          tipo: d.tipo,
          nome: d.nome,
          arquivoUrl: d.arquivoUrl || null,
          dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null,
        })),
      },
    },
  });

  return NextResponse.json(veiculo, { status: 201 });
}
