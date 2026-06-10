/**
 * Status visual (puro — server/client) para contas a receber e a pagar.
 * Deriva o rótulo/cor a partir do status armazenado + data de vencimento.
 */

export interface StatusVisual {
  chave: "PREVISTO" | "A_VENCER" | "VENCE_HOJE" | "VENCIDO" | "PAGO" | "CANCELADO" | "PARCIAL";
  label: string;
  classe: string;
  diasAtraso: number;
  linhaVermelha: boolean;
}

const CLASSES: Record<string, string> = {
  PREVISTO: "bg-primary-50 text-primary-700",
  A_VENCER: "bg-success-50 text-success-700",
  VENCE_HOJE: "bg-amber-50 text-amber-700",
  VENCIDO: "bg-red-100 text-red-700",
  PAGO: "bg-success-100 text-success-700",
  CANCELADO: "bg-slate-100 text-slate-500",
  PARCIAL: "bg-amber-50 text-amber-700",
};

/** Dias entre hoje (00:00) e a data (negativo = vencida). null se sem data. */
export function diasAteVencimento(dataVencimento: Date | string | null | undefined): number | null {
  if (!dataVencimento) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(dataVencimento);
  venc.setHours(0, 0, 0, 0);
  return Math.round((venc.getTime() - hoje.getTime()) / 86400000);
}

function badge(chave: StatusVisual["chave"], label: string, diasAtraso = 0): StatusVisual {
  return { chave, label, classe: CLASSES[chave], diasAtraso, linhaVermelha: chave === "VENCIDO" };
}

export function statusVisualReceber(status: string, dataVencimento: Date | string | null): StatusVisual {
  if (status === "RECEBIDO") return badge("PAGO", "Pago");
  if (status === "CANCELADO") return badge("CANCELADO", "Cancelado");
  const dias = diasAteVencimento(dataVencimento);
  if (dias === null) return badge("PREVISTO", "Previsto");
  if (dias < 0) return badge("VENCIDO", `Vencido ${-dias} ${-dias === 1 ? "dia" : "dias"}`, -dias);
  if (dias === 0) return badge("VENCE_HOJE", "Vence hoje");
  if (status === "PREVISTO") return badge("PREVISTO", "Previsto");
  return badge("A_VENCER", "A vencer");
}

export function statusVisualPagar(status: string, dataVencimento: Date | string | null): StatusVisual {
  if (status === "PAGO_TOTAL") return badge("PAGO", "Pago");
  if (status === "CANCELADO") return badge("CANCELADO", "Cancelado");
  const dias = diasAteVencimento(dataVencimento);
  if (dias !== null && dias < 0) return badge("VENCIDO", `Vencido ${-dias} ${-dias === 1 ? "dia" : "dias"}`, -dias);
  if (status === "PAGO_PARCIAL") return badge("PARCIAL", "Pago parcial");
  if (dias === 0) return badge("VENCE_HOJE", "Vence hoje");
  if (dias === null) return badge("PREVISTO", "Pendente");
  return badge("A_VENCER", "A vencer");
}

export const LABELS_STATUS_CONTA_PAGAR: Record<string, string> = {
  PENDENTE: "Pendente",
  PAGO_PARCIAL: "Pago parcial",
  PAGO_TOTAL: "Pago",
  VENCIDO: "Vencido",
  CANCELADO: "Cancelado",
};
