import { prisma } from "@/lib/prisma";
import { gerarNumeroContaReceber } from "@/lib/utils";

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
