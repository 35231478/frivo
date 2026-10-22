import { prisma } from "@/lib/prisma";

export interface MedicaoDaOs {
  id: string;
  numero: string;
  tokenPublico: string | null;
}

/**
 * Fonte ÚNICA da trava de faturamento da OS (F1/C7): a OS já entrou em alguma medição VIVA?
 * Enxerga os dois caminhos — itens da OS numa medição (MedicaoItem) e o documento integrado
 * (relatório MEDICAO_COMPLETA com medição vinculada). Medição CANCELADA não conta (F4):
 * cancelou, a OS volta a poder ser faturada.
 */
export async function osJaFaturada(osId: string): Promise<MedicaoDaOs | null> {
  const [item, relatorio] = await Promise.all([
    prisma.medicaoItem.findFirst({
      where: { ordemServicoId: osId, medicao: { status: { not: "CANCELADA" } } },
      select: { medicao: { select: { id: true, numero: true, tokenPublico: true } } },
    }),
    prisma.relatorioOs.findFirst({
      where: { ordemServicoId: osId, escopo: "MEDICAO_COMPLETA", medicao: { is: { status: { not: "CANCELADA" } } } },
      select: { medicao: { select: { id: true, numero: true, tokenPublico: true } } },
    }),
  ]);
  return item?.medicao ?? relatorio?.medicao ?? null;
}

/**
 * O que a OS tem PARA faturar (itens executados + adicionais marcados "Cobrar" com preço).
 * A mensalidade do contrato NUNCA entra aqui: ela é cobrada pelo faturamento mensal do contrato.
 */
export async function itensFaturaveisDaOs(osId: string) {
  const [itens, adicionais] = await Promise.all([
    prisma.osItemOrcamento.findMany({ where: { ordemServicoId: osId, executado: true }, orderBy: { id: "asc" } }),
    prisma.servicoAdicional.findMany({
      where: { ordemServicoId: osId, statusCobranca: "COBRAR", valor: { gt: 0 } },
      orderBy: { criadoEm: "asc" },
    }),
  ]);
  return { itens, adicionais };
}
