import type { MedicaoItemInput } from "./validations";

export interface TotaisMedicao {
  valorTotal: number;
  desconto: number;
  valorLiquido: number;
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

/**
 * Calcula os totais de uma medição a partir dos itens e do desconto.
 * Aceita desconto em valor (R$) e em percentual; ambos são somados.
 */
export function calcularTotaisMedicao(
  itens: MedicaoItemInput[],
  descontoValor: number,
  descontoPercent: number,
): TotaisMedicao {
  const valorTotal = itens.reduce(
    (acc, it) => acc + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0),
    0,
  );

  const descPercentual = valorTotal * ((Number(descontoPercent) || 0) / 100);
  const desconto = Math.min(valorTotal, (Number(descontoValor) || 0) + descPercentual);
  const valorLiquido = Math.max(0, valorTotal - desconto);

  return {
    valorTotal: round2(valorTotal),
    desconto: round2(desconto),
    valorLiquido: round2(valorLiquido),
  };
}

/**
 * Define o próximo status quando uma medição é aprovada,
 * considerando se o cliente exige Pedido de Compra (PC) antes da NF.
 */
export function statusAposAprovacao(exigePc: boolean): "AGUARDANDO_PC" | "PC_RECEBIDO" {
  return exigePc ? "AGUARDANDO_PC" : "PC_RECEBIDO";
}

/**
 * Calcula a data de vencimento a partir do dia de faturamento do cliente
 * e do mês/ano de referência da medição.
 */
export function calcularVencimento(
  diaFaturamento: number,
  mes: number | null | undefined,
  ano: number | null | undefined,
): Date {
  const hoje = new Date();
  const m = mes && mes >= 1 && mes <= 12 ? mes - 1 : hoje.getMonth();
  const a = ano ?? hoje.getFullYear();
  const dia = Math.min(Math.max(diaFaturamento || 1, 1), 28);
  return new Date(a, m, dia, 12, 0, 0);
}

export function buildMedicaoPublicUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/medicao/${token}`;
}
