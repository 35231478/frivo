import { prisma } from "@/lib/prisma";

/**
 * Status financeiro calculado dinamicamente a partir das contas a receber
 * vinculadas ao cliente. É um conceito de exibição (3 estados) e NÃO se confunde
 * com o enum `StatusFinanceiro` do banco (que permanece apenas como cache).
 */
export type StatusFinanceiroCalc = "SEM_HISTORICO" | "ADIMPLENTE" | "INADIMPLENTE";

// Uma parcela é considerada "em aberto" (não paga) quando seu status não é
// RECEBIDO (paga) nem CANCELADO (não será cobrada).
const STATUS_EM_ABERTO = ["PREVISTO", "A_RECEBER", "ATRASADO"] as const;

export const LABELS_STATUS_FINANCEIRO_CALC: Record<StatusFinanceiroCalc, string> = {
  SEM_HISTORICO: "Sem histórico financeiro",
  ADIMPLENTE: "Adimplente",
  INADIMPLENTE: "Inadimplente",
};

export const COR_STATUS_FINANCEIRO_CALC: Record<StatusFinanceiroCalc, string> = {
  SEM_HISTORICO: "bg-slate-100 text-slate-600",
  ADIMPLENTE: "bg-success-50 text-success-700",
  INADIMPLENTE: "bg-red-50 text-red-700",
};

function inicioDeHoje(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Calcula o status financeiro de um cliente com base nas contas a receber reais:
 * - SEM_HISTORICO → nenhum lançamento em contas a receber
 * - INADIMPLENTE  → ao menos uma parcela vencida (dataVencimento < hoje) e em aberto
 * - ADIMPLENTE    → possui lançamentos mas nenhum vencido em aberto
 */
export async function calcularStatusFinanceiro(
  clienteId: string,
  empresaId?: string,
): Promise<StatusFinanceiroCalc> {
  const where = { clienteId, ...(empresaId ? { empresaId } : {}) };
  const hoje = inicioDeHoje();

  const [total, vencidasEmAberto] = await Promise.all([
    prisma.contaReceber.count({ where }),
    prisma.contaReceber.count({
      where: { ...where, status: { in: [...STATUS_EM_ABERTO] }, dataVencimento: { lt: hoje } },
    }),
  ]);

  if (total === 0) return "SEM_HISTORICO";
  return vencidasEmAberto > 0 ? "INADIMPLENTE" : "ADIMPLENTE";
}

/**
 * Versão detalhada usada na tela de edição e na API: além do status, retorna
 * o total a receber nos próximos 30 dias (parcelas em aberto com vencimento
 * entre hoje e hoje+30).
 */
export async function calcularStatusFinanceiroDetalhado(
  clienteId: string,
  empresaId?: string,
): Promise<{ status: StatusFinanceiroCalc; totalProximos30Dias: number }> {
  const where = { clienteId, ...(empresaId ? { empresaId } : {}) };
  const hoje = inicioDeHoje();
  const em30Dias = new Date(hoje);
  em30Dias.setDate(em30Dias.getDate() + 30);
  em30Dias.setHours(23, 59, 59, 999);

  const [total, vencidasEmAberto, proximos] = await Promise.all([
    prisma.contaReceber.count({ where }),
    prisma.contaReceber.count({
      where: { ...where, status: { in: [...STATUS_EM_ABERTO] }, dataVencimento: { lt: hoje } },
    }),
    prisma.contaReceber.aggregate({
      _sum: { valor: true },
      where: { ...where, status: { in: [...STATUS_EM_ABERTO] }, dataVencimento: { gte: hoje, lte: em30Dias } },
    }),
  ]);

  const status: StatusFinanceiroCalc =
    total === 0 ? "SEM_HISTORICO" : vencidasEmAberto > 0 ? "INADIMPLENTE" : "ADIMPLENTE";

  return { status, totalProximos30Dias: Number(proximos._sum.valor ?? 0) };
}

/**
 * Calcula o status financeiro de vários clientes de uma vez (evita N+1 nas
 * listagens). Retorna um mapa clienteId → status.
 */
export async function calcularStatusFinanceiroEmLote(
  empresaId: string,
  clienteIds: string[],
): Promise<Record<string, StatusFinanceiroCalc>> {
  const resultado: Record<string, StatusFinanceiroCalc> = {};
  if (clienteIds.length === 0) return resultado;

  const hoje = inicioDeHoje();

  const [comHistorico, comVencidas] = await Promise.all([
    prisma.contaReceber.groupBy({
      by: ["clienteId"],
      where: { empresaId, clienteId: { in: clienteIds } },
      _count: { _all: true },
    }),
    prisma.contaReceber.groupBy({
      by: ["clienteId"],
      where: {
        empresaId,
        clienteId: { in: clienteIds },
        status: { in: [...STATUS_EM_ABERTO] },
        dataVencimento: { lt: hoje },
      },
      _count: { _all: true },
    }),
  ]);

  const temHistorico = new Set(comHistorico.map((g) => g.clienteId));
  const inadimplentes = new Set(comVencidas.map((g) => g.clienteId));

  for (const id of clienteIds) {
    resultado[id] = !temHistorico.has(id)
      ? "SEM_HISTORICO"
      : inadimplentes.has(id)
        ? "INADIMPLENTE"
        : "ADIMPLENTE";
  }

  return resultado;
}
