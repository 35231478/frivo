import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/** Lista os contratos de um cliente com os campos necessários para os cards. */
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const contratos = await prisma.contrato.findMany({
    where: { clienteId: id, empresaId },
    select: {
      id: true, numero: true, tipo: true, status: true,
      valorMensal: true, dataInicio: true, dataFim: true,
      unidades: { select: { unidade: { select: { id: true, nome: true } } } },
    },
    orderBy: [{ dataFim: "asc" }, { criadoEm: "desc" }],
  });

  const view = contratos.map((c) => ({
    id: c.id,
    numero: c.numero,
    tipo: c.tipo,
    status: c.status,
    valorMensal: c.valorMensal != null ? Number(c.valorMensal) : null,
    dataInicio: c.dataInicio ? c.dataInicio.toISOString() : null,
    dataFim: c.dataFim ? c.dataFim.toISOString() : null,
    locais: c.unidades.map((u) => u.unidade.nome),
  }));

  return NextResponse.json(view);
}
