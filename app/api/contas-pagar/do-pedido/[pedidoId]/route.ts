import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { gerarContaPagarDoPedido } from "@/lib/financeiro-server";

type Params = { params: Promise<{ pedidoId: string }> };

export async function POST(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { pedidoId } = await params;
  const empresaId = guard.session.user.empresaId;

  const pedido = await prisma.pedidoCompraInterno.findFirst({ where: { id: pedidoId, empresaId } });
  if (!pedido) return NextResponse.json({ erro: "Pedido não encontrado" }, { status: 404 });

  const conta = await gerarContaPagarDoPedido(pedidoId);
  return NextResponse.json(conta, { status: 201 });
}
