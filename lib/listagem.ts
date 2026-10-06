/**
 * Utilitários comuns das listagens paginadas no servidor (Equipamentos, Veículos…).
 * Arquivo puro: usado no servidor (leitura da URL) e no cliente (paginação).
 */
export const TAMANHOS_PAGINA = [25, 50, 100] as const;

export type ParamsUrl = Record<string, string | string[] | undefined>;

/** Primeiro valor de um parâmetro da URL ("" quando ausente). */
export const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Página (≥1) e itens por página (25/50/100; padrão 50). */
export function lerPaginacao(sp: ParamsUrl): { pagina: number; porPagina: number } {
  const por = Number(um(sp.por));
  return {
    pagina: Math.max(1, Number(um(sp.pagina)) || 1),
    porPagina: (TAMANHOS_PAGINA as readonly number[]).includes(por) ? por : 50,
  };
}
