import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { calcularStatusFinanceiroDetalhado } from "@/lib/status-financeiro";
import { perdasRecentesDoCliente } from "@/lib/financeiro/perda-estorno-server";

type Params = { params: Promise<{ id: string }> };

/**
 * Retorna o status financeiro calculado do cliente (com base nas contas a
 * receber reais) e o total a receber nos próximos 30 dias.
 */
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "visualizar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const [dados, perdas12m] = await Promise.all([calcularStatusFinanceiroDetalhado(id, empresaId), perdasRecentesDoCliente(id, empresaId)]);
  // Perdas nos últimos 12 meses: alerta informativo (não bloqueia) no cadastro e antes de atender
  return NextResponse.json({ ...dados, perdas12m });
}
