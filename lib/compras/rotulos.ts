/** Rótulos/cores da nota de compra (arquivo puro: servidor e tela). */
export const LABEL_STATUS_NOTA = { IMPORTADA: "Importada", CONCILIADA: "Conciliada", LANCADA: "Lançada" } as const;
export const COR_STATUS_NOTA: Record<keyof typeof LABEL_STATUS_NOTA, string> = {
  IMPORTADA: "bg-amber-50 text-amber-700", CONCILIADA: "bg-primary-50 text-primary-700", LANCADA: "bg-success-50 text-success-700",
};
/** Chave de acesso em blocos de 4 (como no DANFE) */
export const chaveEmBlocos = (c: string) => c.replace(/(\d{4})(?=\d)/g, "$1 ");
