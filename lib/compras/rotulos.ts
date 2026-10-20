/** Rótulos/cores da nota de compra (arquivo puro: servidor e tela). */
export const LABEL_STATUS_NOTA = { IMPORTADA: "Importada", CONCILIADA: "Conciliada", LANCADA: "Lançada" } as const;
export const COR_STATUS_NOTA: Record<keyof typeof LABEL_STATUS_NOTA, string> = {
  IMPORTADA: "bg-amber-50 text-amber-700", CONCILIADA: "bg-primary-50 text-primary-700", LANCADA: "bg-success-50 text-success-700",
};
/** Chave de acesso em blocos de 4 (como no DANFE) */
export const chaveEmBlocos = (c: string) => c.replace(/(\d{4})(?=\d)/g, "$1 ");

/** Origem da mercadoria (tabela da NF-e, campo orig do ICMS) */
export const ORIGEM_MERCADORIA: Record<string, string> = {
  "0": "Nacional",
  "1": "Estrangeira — importação direta",
  "2": "Estrangeira — adquirida no mercado interno",
  "3": "Nacional, conteúdo de importação acima de 40%",
  "4": "Nacional, processos produtivos básicos",
  "5": "Nacional, conteúdo de importação até 40%",
  "6": "Estrangeira — importação direta, sem similar nacional",
  "7": "Estrangeira — mercado interno, sem similar nacional",
  "8": "Nacional, conteúdo de importação acima de 70%",
};
export const rotuloOrigem = (o: string | null | undefined) => (o == null || o === "" ? null : `${o} · ${ORIGEM_MERCADORIA[o] ?? "?"}`);
/** NCM 8 dígitos como 8415.10.11 */
export const formatarNcm = (n: string | null | undefined) => (n && /^\d{8}$/.test(n) ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : n ?? null);
