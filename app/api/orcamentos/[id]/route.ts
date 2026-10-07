import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { orcamentoSchema } from "@/lib/validations";
import { calcularTotais, montarCamposProposta } from "@/lib/orcamento-helpers";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import { impactoOrcamento } from "@/lib/inativacao-server";
import { cancelarOrcamento, reativarOrcamento, statusHttp } from "@/lib/acoes-massa/regras";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("orcamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
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

/**
 * Mudanças de status permitidas pelo PUT `{ status }` (origem → destino).
 * APROVADO só vem da assinatura do cliente na página pública (que também gera o financeiro);
 * CONVERTIDA, da conversão em contrato; voltar a RASCUNHO, do "Reativar" (PATCH).
 */
const TRANSICOES_STATUS: Record<string, string[]> = {
  ENVIADO: ["RASCUNHO", "ENVIADO", "REPROVADO"],
  REPROVADO: ["ENVIADO"],
  CANCELADO: ["RASCUNHO", "ENVIADO", "APROVADO", "REPROVADO"],
};

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("orcamentos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.orcamento.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });

  const body = await req.json();

  // Mudança simples de status (enviar, cancelar, reprovar) — só as transições da lista
  if (body.status && Object.keys(body).length === 1) {
    const novo = String(body.status);
    if (novo === existente.status) return NextResponse.json(existente);
    if (!TRANSICOES_STATUS[novo]?.includes(existente.status)) {
      const motivo = novo === "APROVADO"
        ? "A aprovação é feita pelo cliente, com assinatura, no link do orçamento."
        : `Não é possível mudar o orçamento de ${existente.status} para ${novo}.`;
      return NextResponse.json({ erro: motivo }, { status: 400 });
    }
    // Cancelar = inativar o orçamento: mesma regra do botão (exige "excluir" e não pode ter virado contrato/financeiro)
    if (novo === "CANCELADO") {
      if (!pode(session.user!.permissoes, "orcamentos", "excluir", session.user!.role))
        return NextResponse.json({ erro: "Sem permissão para cancelar orçamentos" }, { status: 403 });
      const impacto = await impactoOrcamento(id, empresaId);
      if (impacto?.bloqueio) return NextResponse.json({ erro: impacto.bloqueio }, { status: 409 });
    }
    const atualizado = await prisma.orcamento.update({
      where: { id },
      data: {
        status: novo as typeof existente.status,
        enviadoEm: novo === "ENVIADO" ? new Date() : existente.enviadoEm,
      },
    });
    return NextResponse.json(atualizado);
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
  const proposta = montarCamposProposta(data);

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
        ...proposta,
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

/**
 * Inativa o orçamento — soft-delete: vira CANCELADO (nada é apagado; itens, vínculos
 * com OS e o link público são preservados) e pode ser reaberto depois.
 * Bloqueia orçamento que virou contrato, entrou no financeiro ou está aprovado em execução numa OS.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("orcamentos", "excluir");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;

  // Mesma regra da ação em massa (lib/acoes-massa/regras.ts)
  const r = await cancelarOrcamento(id, { empresaId, usuarioId: guard.session.user!.id, usuarioNome: guard.session.user!.name ?? "usuário" });
  if (!r.ok) return NextResponse.json({ erro: r.codigo === "nao_encontrado" ? "Orçamento não encontrado" : r.motivo }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true, status: "CANCELADO" });
}

/** Reabre um orçamento cancelado (volta para RASCUNHO, editável). Exige "editar". */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("orcamentos", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body?.ativo !== true) return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });

  const r = await reativarOrcamento(id, { empresaId, usuarioId: guard.session.user!.id, usuarioNome: guard.session.user!.name ?? "usuário" });
  if (!r.ok) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true, status: r.dados?.status });
}
