import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, itemId } = await params;
  if (!(await osDaEmpresa(id, session.user!.empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
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
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, itemId } = await params;
  if (!(await osDaEmpresa(id, session.user!.empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  // Só apaga item desta OS (antes apagava qualquer item pelo id, de qualquer OS/empresa)
  const item = await prisma.osItemOrcamento.findFirst({ where: { id: itemId, ordemServicoId: id }, select: { id: true } });
  if (!item) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  await prisma.osItemOrcamento.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
