import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { avisarSolicitanteNf, desvincularNota, ErroConciliacao, vincularNota } from "@/lib/compras/conciliacao-server";

type Params = { params: Promise<{ id: string }> };
const corpoSchema = z.object({ pedidoId: z.string().min(1).max(64) });

/**
 * POST /api/compras/notas/:id/vinculos { pedidoId } — vincula a NF (já lançada) ao pedido de compra,
 * item a item: valor real nos itens, status Parcial/Concluída, histórico e aviso ao solicitante.
 * Vincular de novo não duplica (200, criados = 0). Compras › gerenciar; empresa da sessão.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("compras", "gerenciar");
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  const { id } = await params;
  const parsed = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: "Escolha o pedido de compra." }, { status: 400 });
  const nota = await prisma.notaCompra.findFirst({ where: { id, empresaId: user.empresaId }, select: { status: true } });
  if (!nota) return NextResponse.json({ erro: "Nota não encontrada." }, { status: 404 });
  if (nota.status !== "LANCADA") return NextResponse.json({ erro: "Lance a nota antes: o vínculo usa os produtos e as quantidades já conferidos." }, { status: 409 });
  try {
    const r = await prisma.$transaction((tx) => vincularNota(tx, { empresaId: user.empresaId, usuarioId: user.id, notaId: id, pedidoId: parsed.data.pedidoId }));
    if (r?.criados) await avisarSolicitanteNf(r.pedidoId, id);
    return NextResponse.json(r, { status: r?.criados ? 201 : 200 });
  } catch (e) {
    if (e instanceof ErroConciliacao) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}

/**
 * DELETE /api/compras/notas/:id/vinculos?pedidoId= — desfaz o vínculo da NF com o pedido: volta o
 * status e o valor real dos itens, registra no histórico. Compras › gerenciar; empresa da sessão.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("compras", "gerenciar");
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  const { id } = await params;
  const pedidoId = req.nextUrl.searchParams.get("pedidoId")?.trim();
  if (!pedidoId) return NextResponse.json({ erro: "Informe o pedido de compra." }, { status: 400 });
  try {
    const r = await prisma.$transaction((tx) => desvincularNota(tx, { empresaId: user.empresaId, usuarioId: user.id, notaId: id, pedidoId }));
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ErroConciliacao) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
