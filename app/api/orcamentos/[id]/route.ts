import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orcamentoSchema } from "@/lib/validations";
import { calcularTotais } from "@/lib/orcamento-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id, empresaId },
    include: {
      cliente: true,
      criadoPor: { select: { id: true, nome: true } },
      servicos: { include: { servico: { select: { id: true, nome: true, unidade: true } } }, orderBy: { ordem: "asc" } },
      produtos: { include: { produto: { select: { id: true, nome: true, unidade: true } } }, orderBy: { ordem: "asc" } },
      ordensServico: {
        include: {
          ordemServico: { select: { id: true, numero: true, status: true, descricao: true } },
        },
      },
    },
  });
  if (!orcamento) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });

  return NextResponse.json(orcamento);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.orcamento.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });

  const body = await req.json();

  // Mudança simples de status (enviar, cancelar, reprovar)
  if (body.status && Object.keys(body).length === 1) {
    const novo = await prisma.orcamento.update({
      where: { id },
      data: {
        status: body.status,
        enviadoEm: body.status === "ENVIADO" ? new Date() : existente.enviadoEm,
      },
    });
    return NextResponse.json(novo);
  }

  // Edição completa só em RASCUNHO
  if (existente.status !== "RASCUNHO") {
    return NextResponse.json(
      { erro: "Apenas orçamentos em rascunho podem ser editados" },
      { status: 400 }
    );
  }

  const parsed = orcamentoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: "Dados inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // Valida que as OS vinculadas pertencem ao mesmo tenant e cliente (evita vínculo cross-tenant)
  if (data.ordensServicoIds.length) {
    const validas = await prisma.ordemServico.count({
      where: { id: { in: data.ordensServicoIds }, empresaId, clienteId: data.clienteId },
    });
    if (validas !== data.ordensServicoIds.length) {
      return NextResponse.json(
        { erro: "Uma ou mais ordens de serviço são inválidas ou não pertencem a este cliente" },
        { status: 400 }
      );
    }
  }

  const totais = calcularTotais(data.servicos, data.produtos, data.desconto, data.tipoDesconto);

  const atualizado = await prisma.$transaction(async (tx) => {
    await tx.orcamentoServico.deleteMany({ where: { orcamentoId: id } });
    await tx.orcamentoProduto.deleteMany({ where: { orcamentoId: id } });
    await tx.orcamentoOs.deleteMany({ where: { orcamentoId: id } });

    return tx.orcamento.update({
      where: { id },
      data: {
        nome: data.nome,
        clienteId: data.clienteId,
        descricao: data.descricao ?? null,
        observacao: data.observacao ?? null,
        validadeEm: data.validadeEm ? new Date(data.validadeEm) : null,
        desconto: data.desconto,
        tipoDesconto: data.tipoDesconto,
        totalServicos: totais.totalServicos,
        totalProdutos: totais.totalProdutos,
        totalGeral: totais.totalGeral,
        servicos: {
          create: data.servicos.map((s, idx) => ({
            servicoId: s.catalogoId || null,
            descricao: s.descricao,
            quantidade: s.quantidade,
            valorUnitario: s.valorUnitario,
            valorTotal: s.quantidade * s.valorUnitario,
            observacao: s.observacao ?? null,
            ordem: idx,
          })),
        },
        produtos: {
          create: data.produtos.map((p, idx) => ({
            produtoId: p.catalogoId || null,
            descricao: p.descricao,
            quantidade: p.quantidade,
            valorUnitario: p.valorUnitario,
            valorTotal: p.quantidade * p.valorUnitario,
            observacao: p.observacao ?? null,
            ordem: idx,
          })),
        },
        ordensServico: {
          create: data.ordensServicoIds.map((osId) => ({ ordemServicoId: osId })),
        },
      },
    });
  });

  return NextResponse.json(atualizado);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.orcamento.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (existente.status === "APROVADO") {
    return NextResponse.json(
      { erro: "Orçamento aprovado não pode ser excluído. Cancele-o." },
      { status: 400 }
    );
  }

  await prisma.orcamento.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
