import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LABEL_STATUS_PEDIDO, pedidoEncerrado, podeEditarPedido, type StatusPedido } from "@/lib/compras/pedido";
import { carregarPedido, registrarEventoPedido } from "@/lib/compras/pedido-server";

const corpoSchema = z.object({ motivo: z.string().trim().max(500).optional().nullable() }).nullable();

/** Cancelar o pedido (quem pode editar), com o motivo opcional no histórico. Concluído/cancelado: não. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const u = session.user!;
  const pedido = await carregarPedido(id, u.empresaId);
  if (!pedido) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  if (!podeEditarPedido(u, pedido)) return NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });
  if (pedidoEncerrado(pedido.status)) {
    return NextResponse.json({ erro: `Pedido já ${LABEL_STATUS_PEDIDO[pedido.status as StatusPedido].toLowerCase()}.` }, { status: 409 });
  }
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  const motivo = corpo.success ? corpo.data?.motivo || null : null;

  await prisma.$transaction(async (tx) => {
    await tx.pedidoCompraInterno.update({ where: { id }, data: { status: "CANCELADO", statusEm: new Date() } });
    await registrarEventoPedido({ empresaId: u.empresaId, pedidoId: id, tipo: "CANCELADO", detalhe: motivo, usuarioId: u.id }, tx);
  });
  return NextResponse.json({ ok: true, status: "CANCELADO" });
}
