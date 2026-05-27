import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const final = body.final === true;

  // Busca itens financeiros não medidos
  const itensSemMedicao = await prisma.osItemFinanceiro.findMany({
    where: { ordemServicoId: id, medicaoId: null },
  });

  if (itensSemMedicao.length === 0) {
    return NextResponse.json({ erro: "Não há itens executados pendentes de medição." }, { status: 400 });
  }

  const valorTotal = itensSemMedicao.reduce((acc, i) => acc + Number(i.valorTotal), 0);
  const ultimaMedicao = await prisma.osMedicao.findFirst({
    where: { ordemServicoId: id },
    orderBy: { numero: "desc" },
  });

  const medicao = await prisma.osMedicao.create({
    data: {
      ordemServicoId: id,
      numero: (ultimaMedicao?.numero ?? 0) + 1,
      valorTotal,
    },
  });

  // Vincula itens à medição
  await prisma.osItemFinanceiro.updateMany({
    where: { id: { in: itensSemMedicao.map((i) => i.id) } },
    data: { medicaoId: medicao.id },
  });

  await prisma.osHistorico.create({
    data: {
      ordemServicoId: id, usuarioId: session.user!.id,
      acao: final ? "Medição final gerada" : "Medição parcial gerada",
      detalhes: `Medição #${medicao.numero} — R$ ${valorTotal.toFixed(2)}`,
    },
  });

  return NextResponse.json(medicao, { status: 201 });
}
