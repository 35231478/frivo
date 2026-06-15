import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calcularStatusFinanceiroDetalhado } from "@/lib/status-financeiro";

type Params = { params: Promise<{ id: string }> };

/**
 * Retorna o status financeiro calculado do cliente (com base nas contas a
 * receber reais) e o total a receber nos próximos 30 dias.
 */
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const dados = await calcularStatusFinanceiroDetalhado(id, empresaId);
  return NextResponse.json(dados);
}
