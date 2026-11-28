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

/**
 * O número da página não volta (volta-se sempre à 1ª); nem o "de onde veio" (`de=contas-pagar` muda o voltar e os
 * links da tela: é da navegação daquele momento, não um filtro). O resto da query, sim — inclusive o `de` que é
 * DATA (o início do período, AAAA-MM-DD), que é filtro.
 */
const NAO_LEMBRAR = ["pagina"];
const ehData = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const chaveFiltrosLembrados = (empresaId: string, usuarioId: string, tela: string) => `frivo:filtros:${empresaId}:${usuarioId}:${tela}`;

/**
 * A query a guardar (sem a página). `navegacao`: parâmetros que são da TELA e não filtro (ex.: `aba` de uma
 * tela com abas, cada uma com os seus filtros lembrados) — não entram no guardado.
 */
export function paraLembrar(query: string, navegacao: readonly string[] = []): string {
  const p = new URLSearchParams(query);
  for (const k of [...NAO_LEMBRAR, ...navegacao]) p.delete(k);
  if (p.has("de") && !ehData(p.get("de"))) p.delete("de");
  return p.toString();
}

/** O que gravar no navegador */
export const lembrado = (query: string, dia: string, navegacao: readonly string[] = []): string =>
  JSON.stringify({ q: paraLembrar(query, navegacao), dia } satisfies FiltroLembrado);

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

/** A lista abriu "limpa" (sem nenhum parâmetro, fora os de `navegacao`)? Só então o lembrado entra. */
export function abriuLimpa(query: string, navegacao: readonly string[] = []): boolean {
  const p = new URLSearchParams(query);
  for (const k of navegacao) p.delete(k);
  return p.toString() === "";
}

/** O filtro a restaurar junto com os parâmetros de navegação da URL de agora (ex.: a `aba` em que se está) */
export function comNavegacao(salvo: string, atual: string, navegacao: readonly string[]): string {
  const p = new URLSearchParams(salvo);
  const a = new URLSearchParams(atual);
  for (const k of navegacao) { const v = a.get(k); if (v !== null) p.set(k, v); }
  return p.toString();
}
