import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gerarNumeroMedicao } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

/**
 * Gera uma medição de adicional vinculada a uma OS, a partir dos itens de
 * orçamento da OS. Idempotente: se já existir medição para esta OS, retorna-a.
 */
export async function POST(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    include: { itensOrcamento: true, cliente: { select: { id: true } } },
  });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const existente = await prisma.medicaoItem.findFirst({
    where: { ordemServicoId: id, medicao: { status: { not: "CANCELADA" } } },
    select: { medicaoId: true },
  });
  if (existente) {
    return NextResponse.json({ id: existente.medicaoId, jaExistia: true });
  }

  const itens = os.itensOrcamento;
  const agora = new Date();
  const ano = agora.getFullYear();
  const sequencial = (await prisma.medicao.count({ where: { empresaId } })) + 1;
  const numero = gerarNumeroMedicao(sequencial, ano);

  const valorTotal = itens.reduce((acc, it) => acc + Number(it.valorTotal), 0);

  const medicao = await prisma.medicao.create({
    data: {
      empresaId,
      clienteId: os.clienteId,
      numero,
      tipo: "ADICIONAL",
      mes: agora.getMonth() + 1,
      ano,
      descricao: `Adicional — OS ${os.numero}`,
      status: "RASCUNHO",
      valorTotal,
      valorLiquido: valorTotal,
      tokenPublico: crypto.randomUUID(),
      itens: {
        create: itens.map((it, idx) => ({
          tipo: "SERVICO" as const,
          ordemServicoId: os.id,
          descricao: it.descricao,
          quantidade: Number(it.quantidade),
          valorUnitario: Number(it.valorUnitario),
          valorTotal: Number(it.valorTotal),
          ordem: idx,
        })),
      },
    },
  });

  return NextResponse.json({ id: medicao.id, jaExistia: false }, { status: 201 });
}
