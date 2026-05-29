import { prisma } from "@/lib/prisma";
import { gerarNumeroContaReceber, gerarNumeroMedicao } from "@/lib/utils";
import { calcularVencimento } from "@/lib/medicao-helpers";

/**
 * Cria (de forma idempotente) uma conta a receber a partir de uma medição.
 * Se já existir conta vinculada à medição, retorna a existente.
 */
export async function gerarContaReceberDaMedicao(medicaoId: string) {
  const existente = await prisma.contaReceber.findFirst({ where: { medicaoId } });
  if (existente) return existente;

  const medicao = await prisma.medicao.findUnique({ where: { id: medicaoId } });
  if (!medicao) return null;

  const total = await prisma.contaReceber.count({ where: { empresaId: medicao.empresaId } });
  const numero = gerarNumeroContaReceber(total + 1, medicao.ano ?? new Date().getFullYear());

  return prisma.contaReceber.create({
    data: {
      empresaId: medicao.empresaId,
      clienteId: medicao.clienteId,
      medicaoId: medicao.id,
      numero,
      descricao: medicao.descricao || `Medição ${medicao.numero}`,
      valor: medicao.valorLiquido,
      status: "PREVISTO",
      dataVencimento: medicao.dataVencimento,
    },
  });
}

/**
 * Cria (de forma idempotente) uma conta a receber a partir de um orçamento aprovado.
 */
export async function gerarContaReceberDoOrcamento(orcamentoId: string) {
  const existente = await prisma.contaReceber.findFirst({ where: { orcamentoId } });
  if (existente) return existente;

  const orcamento = await prisma.orcamento.findUnique({ where: { id: orcamentoId } });
  if (!orcamento) return null;

  const total = await prisma.contaReceber.count({ where: { empresaId: orcamento.empresaId } });
  const numero = gerarNumeroContaReceber(total + 1);

  return prisma.contaReceber.create({
    data: {
      empresaId: orcamento.empresaId,
      clienteId: orcamento.clienteId,
      orcamentoId: orcamento.id,
      numero,
      descricao: `Orçamento ${orcamento.codigo} — ${orcamento.nome}`,
      valor: orcamento.totalGeral,
      status: "PREVISTO",
      dataVencimento: orcamento.validadeEm,
    },
  });
}

/**
 * Cria (de forma idempotente) uma medição financeira a partir de um relatório
 * aprovado. O status segue o perfil de faturamento do cliente:
 * - COM_APROVACAO (perfil 1) → AGUARDANDO_PC
 * - AUTOMATICO (perfil 2)    → NF_EMITIDA (preparado para integração de NF)
 * - FATURA_UNICA (perfil 3)  → RASCUNHO (aguarda agrupamento do mês)
 * - sem perfil               → PC_RECEBIDO (libera NF)
 */
export async function criarMedicaoDeRelatorio(relatorioId: string) {
  const relatorio = await prisma.relatorioOs.findUnique({
    where: { id: relatorioId },
    include: { ordemServico: { include: { cliente: true } } },
  });
  if (!relatorio) return null;
  if (relatorio.medicaoId) return prisma.medicao.findUnique({ where: { id: relatorio.medicaoId } });

  const cliente = relatorio.ordemServico.cliente;
  const perfil = cliente.tipoFaturamento;
  const status =
    perfil === "COM_APROVACAO" ? "AGUARDANDO_PC" :
    perfil === "AUTOMATICO" ? "NF_EMITIDA" :
    perfil === "FATURA_UNICA" ? "RASCUNHO" :
    "PC_RECEBIDO";

  const valor = relatorio.valorFinanceiro ? Number(relatorio.valorFinanceiro) : 0;
  const seq = (await prisma.medicao.count({ where: { empresaId: relatorio.empresaId } })) + 1;
  const numero = gerarNumeroMedicao(seq, relatorio.anoReferencia);
  const vencimento = calcularVencimento(cliente.diaFaturamento, relatorio.mesReferencia, relatorio.anoReferencia);

  const medicao = await prisma.medicao.create({
    data: {
      empresaId: relatorio.empresaId,
      clienteId: relatorio.ordemServico.clienteId,
      contratoId: relatorio.contratoId,
      numero,
      tipo: "MENSAL_FIXO",
      mes: relatorio.mesReferencia,
      ano: relatorio.anoReferencia,
      descricao: `Relatório ${relatorio.numero}`,
      status: status as any,
      valorTotal: valor,
      valorLiquido: valor,
      dataAprovacao: new Date(),
      dataVencimento: vencimento,
      tokenPublico: crypto.randomUUID(),
      itens: {
        create: [{
          tipo: "SERVICO",
          descricao: `Serviço do período — ${relatorio.numero}`,
          quantidade: 1,
          valorUnitario: valor,
          valorTotal: valor,
          ordem: 0,
        }],
      },
    },
  });

  await prisma.relatorioOs.update({ where: { id: relatorioId }, data: { medicaoId: medicao.id } });

  // Gera conta a receber, exceto quando aguarda agrupamento (perfil fatura única)
  if (perfil !== "FATURA_UNICA") {
    await gerarContaReceberDaMedicao(medicao.id);
  }

  return medicao;
}
