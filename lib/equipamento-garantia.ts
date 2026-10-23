import { diasAteDiaCivil } from "@/lib/fuso";

/**
 * Situação da garantia de um equipamento a partir da data de fim. Arquivo puro (server e client).
 * O fim é dia civil: a garantia vale o dia inteiro (vencida só no dia seguinte, em Brasília).
 */
export type SituacaoGarantia = "vigente" | "vencendo" | "vencida";

/** Dias de antecedência para considerar a garantia "vencendo". */
export const DIAS_AVISO_GARANTIA = 30;

export function situacaoGarantia(fim: Date | string | null | undefined, hoje = new Date()): SituacaoGarantia | null {
  if (!fim) return null;
  const dias = diasAteDiaCivil(fim, hoje)!;
  if (dias < 0) return "vencida";
  if (dias <= DIAS_AVISO_GARANTIA) return "vencendo";
  return "vigente";
}

export const LABELS_SITUACAO_GARANTIA: Record<SituacaoGarantia, string> = {
  vigente: "Em garantia",
  vencendo: "Garantia vencendo",
  vencida: "Garantia vencida",
};

export const COR_SITUACAO_GARANTIA: Record<SituacaoGarantia, string> = {
  vigente: "text-emerald-700 bg-emerald-50",
  vencendo: "text-amber-700 bg-amber-50",
  vencida: "text-red-600 bg-red-50",
};

/** Dias até o fim da garantia (negativo = vencida há N dias). */
export function diasRestantesGarantia(fim: Date | string | null | undefined, hoje = new Date()): number | null {
  return diasAteDiaCivil(fim, hoje);
}
