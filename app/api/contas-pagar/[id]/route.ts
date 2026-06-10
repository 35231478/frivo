import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contaPagarUpdateSchema } from "@/lib/validations";
import { exigirPermissao } from "@/lib/permissoes-server";
import { recalcularContaPagar } from "@/lib/financeiro-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;

  const conta = await prisma.contaPagar.findFirst({
    where: { id, empresaId: guard.session.user.empresaId },
    include: { pagamentos: { orderBy: { dataPagamento: "desc" } }, pedidoCompra: { select: { numero: true } } },
  });
  if (!conta) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
  return NextResponse.json(conta);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const existente = await prisma.contaPagar.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  const parsed = contaPagarUpdateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const d = parsed.data;

  await prisma.contaPagar.update({
    where: { id },
    data: {
      fornecedor: d.fornecedor,
      fornecedorCnpj: d.fornecedorCnpj === undefined ? undefined : d.fornecedorCnpj || null,
      descricao: d.descricao,
      valorTotal: d.valorTotal,
      saldoRestante: d.valorTotal !== undefined ? Math.max(0, d.valorTotal - Number(existente.valorPago)) : undefined,
      dataVencimento: d.dataVencimento === undefined ? undefined : d.dataVencimento ? new Date(d.dataVencimento) : null,
      formaPagamento: d.formaPagamento === undefined ? undefined : d.formaPagamento || null,
      banco: d.banco === undefined ? undefined : d.banco || null,
      observacao: d.observacao === undefined ? undefined : d.observacao || null,
    },
  });
  const conta = await recalcularContaPagar(id);
  return NextResponse.json(conta);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const existente = await prisma.contaPagar.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  // Cancelar (não excluir) para preservar histórico
  await prisma.contaPagar.update({ where: { id }, data: { status: "CANCELADO" } });
  return NextResponse.json({ ok: true });
}
