import { NextRequest, NextResponse } from "next/server";
import { MSG_FORA_DO_ESCOPO, pedidoForaDoEscopo } from "@/lib/escopo/proprios-server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { confirmarPedidoDoPortal, recusarPedidoDoPortal } from "@/lib/pedido-cliente/server";
import { MSG_SEM_PERMISSAO_PEDIDO, podeInformarPedido } from "@/lib/pedido-cliente/acesso";

/**
 * PC-2 — CONFERIR o pedido de compra que o comprador anexou no portal:
 *  - `confirmar`: liga às OS e orçamentos que ele cobre e o faturamento segue (o mesmo caminho de informar o pedido);
 *  - `recusar`: com o motivo (5 a 300 caracteres), que o cliente vê no portal. Nada é ligado.
 * Quem pode: quem informa o pedido do cliente para esses itens (lib/pedido-cliente/acesso).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  // COM-1: "Ver só os próprios" — pedido que cobre OS/orçamento de outro vendedor não existe para a pessoa
  if (await pedidoForaDoEscopo(session.user, id)) return NextResponse.json({ erro: MSG_FORA_DO_ESCOPO }, { status: 404 });
  const corpo = await req.json().catch(() => null);
  const acao = corpo && typeof corpo === "object" ? corpo.acao : null;
  if (acao !== "confirmar" && acao !== "recusar") return NextResponse.json({ erro: "Ação inválida." }, { status: 400 });
  const p = await prisma.pedidoCliente.findFirst({ where: { id, empresaId: session.user.empresaId }, select: { osPropostas: true, orcamentosPropostos: true } });
  if (!p) return NextResponse.json({ erro: "Pedido do cliente não encontrado." }, { status: 404 });
  if (!podeInformarPedido(session, { os: p.osPropostas.length > 0, orcamentos: p.orcamentosPropostos.length > 0 })) {
    return NextResponse.json({ erro: MSG_SEM_PERMISSAO_PEDIDO }, { status: 403 });
  }
  const quem = { empresaId: session.user.empresaId, usuarioId: session.user.id };
  const r = acao === "confirmar" ? await confirmarPedidoDoPortal(quem, id) : await recusarPedidoDoPortal(quem, id, corpo.motivo);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r);
}
