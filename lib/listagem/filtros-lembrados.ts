/**
 * FILTROS LEMBRADOS das listas — a regra pura (o hook está em components/listagem/use-filtros-lembrados).
 *
 * Sair da lista e voltar mantém o que a pessoa escolheu (período, situação, técnico, busca, ordenação,
 * itens por página). Guardado no navegador, separado por EMPRESA e por USUÁRIO (dois logins no mesmo
 * computador não se misturam), e vale só no MESMO DIA de Brasília: de um dia para o outro — um novo
 * login no dia seguinte, por exemplo — a lista volta ao padrão; um login curto no mesmo dia mantém.
 *
 * A URL continua sendo a fonte: só se restaura quando a lista abre SEM parâmetros. Um link com filtro
 * (compartilhado, do sino, do painel de pendências) vence o lembrado e passa a ser o lembrado.
 */

/** O que fica guardado: a query da lista e o dia (AAAA-MM-DD de Brasília) em que foi guardada */
export interface FiltroLembrado { q: string; dia: string }

/** O número da página não volta (volta-se sempre à 1ª); o resto da query, sim */
const NAO_LEMBRAR = ["pagina"];

export const chaveFiltrosLembrados = (empresaId: string, usuarioId: string, tela: string) => `frivo:filtros:${empresaId}:${usuarioId}:${tela}`;

/** A query a guardar (sem a página) */
export function paraLembrar(query: string): string {
  const p = new URLSearchParams(query);
  for (const k of NAO_LEMBRAR) p.delete(k);
  return p.toString();
}

/** O que gravar no navegador */
export const lembrado = (query: string, dia: string): string => JSON.stringify({ q: paraLembrar(query), dia } satisfies FiltroLembrado);

/**
 * O filtro a restaurar, ou null: só o guardado HOJE (outro dia = volta ao padrão) e não vazio. Qualquer
 * coisa torta no navegador (JSON quebrado, formato antigo) vira null — a lista abre no padrão.
 */
export function filtroDeHoje(guardado: string | null | undefined, hoje: string): string | null {
  if (!guardado) return null;
  try {
    const v = JSON.parse(guardado) as Partial<FiltroLembrado>;
    if (!v || typeof v.q !== "string" || v.dia !== hoje) return null;
    return v.q || null;
  } catch { return null; }
}

/** A lista abriu "limpa" (sem nenhum parâmetro)? Só então o lembrado entra. */
export const abriuLimpa = (query: string) => new URLSearchParams(query).toString() === "";
