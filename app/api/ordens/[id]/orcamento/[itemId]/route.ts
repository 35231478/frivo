import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, itemId } = await params;
  const body = await req.json();

  const item = await prisma.osItemOrcamento.findFirst({ where: { id: itemId, ordemServicoId: id } });
  if (!item) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  if (body.executado === true && !item.executado) {
    const atualizado = await prisma.osItemOrcamento.update({
      where: { id: itemId },
      data: { executado: true, executadoEm: new Date() },
    });

    // Cria item financeiro automaticamente
    await prisma.osItemFinanceiro.create({
      data: {
        ordemServicoId: id,
        itemOrcamentoId: itemId,
        descricao: item.descricao,
        quantidade: item.quantidade,
        valorTotal: item.valorTotal,
      },
    });

    await prisma.osHistorico.create({
      data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Item executado", detalhes: item.descricao },
    });

    return NextResponse.json(atualizado);
  }

  return NextResponse.json(item);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, itemId } = await params;

  await prisma.osItemOrcamento.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
