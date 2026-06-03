import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gerarNumeroContrato } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

/**
 * Converte uma proposta de contrato APROVADA em um Contrato ATIVO.
 * Idempotente: se a proposta já gerou um contrato, retorna o existente.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id, empresaId },
    include: { contratoGerado: { select: { id: true, numero: true } } },
  });
  if (!orcamento) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });

  // Idempotência
  if (orcamento.contratoGerado) {
    return NextResponse.json({ contratoId: orcamento.contratoGerado.id, numero: orcamento.contratoGerado.numero, jaExistia: true });
  }

  if (orcamento.tipo !== "PROPOSTA_CONTRATO") {
    return NextResponse.json({ erro: "Este orçamento não é uma proposta de contrato." }, { status: 400 });
  }
  if (orcamento.status !== "APROVADO") {
    return NextResponse.json({ erro: "A proposta precisa estar aprovada pelo cliente para ser convertida." }, { status: 400 });
  }

  // Unidades cobertas: derivadas dos equipamentos selecionados na proposta
  const unidadeIds = orcamento.equipamentosCobertos.length
    ? [...new Set(
        (await prisma.equipamento.findMany({
          where: { id: { in: orcamento.equipamentosCobertos }, empresaId },
          select: { unidadeId: true },
        })).map((e) => e.unidadeId),
      )]
    : [];

  // Numeração CT-AAAA-NNN derivada do maior do ano
  const ano = new Date().getFullYear();
  const ultimo = await prisma.contrato.findFirst({
    where: { empresaId, numero: { startsWith: `CT-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const seq = (ultimo ? Number(ultimo.numero.split("-")[2]) : 0) + 1;
  const numero = gerarNumeroContrato(seq);

  const contrato = await prisma.$transaction(async (tx) => {
    const novo = await tx.contrato.create({
      data: {
        empresaId,
        clienteId: orcamento.clienteId,
        numero,
        tipo: "MANUTENCAO_PREVENTIVA",
        status: "ATIVO",
        periodicidade: orcamento.frequenciaContrato ?? "MENSAL",
        valorMensal: orcamento.valorMensal,
        valorTotal: orcamento.totalGeral,
        dataInicio: orcamento.dataInicioContrato ?? new Date(),
        dataFim: orcamento.dataFimContrato,
        diaVencimento: orcamento.diaFaturamento,
        artNumero: orcamento.artNumero,
        responsavelTecnicoId: orcamento.responsavelTecnicoId,
        observacoes: orcamento.descricao,
        origemOrcamentoId: orcamento.id,
        // Recorrência de OS já configurada a partir da proposta
        recorrencia: true,
        frequenciaRecorrencia: orcamento.frequenciaContrato ?? "MENSAL",
        diaRecorrencia: orcamento.diaExecucao && orcamento.diaExecucao <= 28 ? orcamento.diaExecucao : null,
        unidades: unidadeIds.length ? { create: unidadeIds.map((unidadeId) => ({ unidadeId })) } : undefined,
      },
    });

    // Marca a proposta como convertida
    await tx.orcamento.update({ where: { id: orcamento.id }, data: { status: "CONVERTIDA" } });

    // Espelha o perfil de faturamento acordado no cliente
    await tx.cliente.update({
      where: { id: orcamento.clienteId },
      data: {
        ...(orcamento.perfilFaturamento ? { tipoFaturamento: orcamento.perfilFaturamento } : {}),
        ...(orcamento.diaFaturamento ? { diaFaturamento: orcamento.diaFaturamento } : {}),
        ...(orcamento.condicaoPagamento ? { condicaoPagamento: orcamento.condicaoPagamento } : {}),
        exigePcAntesNf: orcamento.exigePcAntesNf,
      },
    });

    return novo;
  });

  return NextResponse.json({ contratoId: contrato.id, numero: contrato.numero, jaExistia: false }, { status: 201 });
}
