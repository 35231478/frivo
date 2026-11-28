import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { carregarHistoricoCliente } from "@/lib/clientes/historico-server";

/**
 * Leva H — o HISTÓRICO AUTOMÁTICO do cliente (a linha do tempo da ficha). Quem vê o cliente vê o histórico; as
 * faturas, os pagamentos e as cobranças só entram para quem vê o financeiro. Cliente de outra empresa: 404.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("clientes", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const u = guard.session.user!;
  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId: u.empresaId }, select: { id: true } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });
  const comFinanceiro = pode(u.permissoes, "financeiro", "contasReceber", u.role) || pode(u.permissoes, "financeiro", "medicoes", u.role);
  const eventos = await carregarHistoricoCliente(u.empresaId, id, { comFinanceiro });
  return NextResponse.json({ eventos });
}
