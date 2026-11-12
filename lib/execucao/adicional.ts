/** Serviço adicional (pedido na visita) — rótulos da situação de cobrança (o adm decide). */
export type StatusCobranca = "A_AVALIAR" | "COBRAR" | "NAO_COBRAR";
export const ROTULO_COBRANCA: Record<StatusCobranca, string> = { A_AVALIAR: "A avaliar", COBRAR: "Cobrar", NAO_COBRAR: "Não cobrar" };
