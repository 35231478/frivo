import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contratoSchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const clienteId = searchParams.get("clienteId");

  const contratos = await prisma.contrato.findMany({
    where: { empresaId, ...(clienteId && { clienteId }) },
    select: { id: true, numero: true, tipo: true, status: true, clienteId: true },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(contratos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;
  const body = await req.json();
  const parsed = contratoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const dup = await prisma.contrato.findUnique({
    where: { numero_empresaId: { numero: parsed.data.numero, empresaId } },
  });
  if (dup) return NextResponse.json({ erro: "Número de contrato já cadastrado" }, { status: 409 });

  const { unidadeIds, dataInicio, dataFim, valorMensal, valorTotal, responsavelTecnicoId, ...resto } = parsed.data;

  const contrato = await prisma.contrato.create({
    data: {
      ...resto,
      empresaId,
      dataInicio: new Date(dataInicio),
      dataFim: dataFim ? new Date(dataFim) : null,
      valorMensal: valorMensal ?? null,
      valorTotal: valorTotal ?? null,
      responsavelTecnicoId: responsavelTecnicoId || null,
      unidades: {
        create: unidadeIds.map((unidadeId) => ({ unidadeId })),
      },
    },
    include: { unidades: true },
  });

  return NextResponse.json(contrato, { status: 201 });
}
