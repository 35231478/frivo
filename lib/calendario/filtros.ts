/**
 * Calendário — os FILTROS, puros e num lugar só.
 *
 * Como o calendário filtra: a página carrega TODAS as OS do período e os filtros rodam no
 * navegador, ESMAECENDO o que não corresponde em vez de sumir com o cartão. É de propósito —
 * quem filtra por um técnico continua vendo que o dia 12 está cheio de outra coisa.
 *
 * Até esta leva o predicado morava dentro do componente do painel e não tinha teste nenhum: dava
 * para quebrar um filtro sem nada acusar. Agora ele é uma função pura, com um teste por filtro e
 * um para a combinação (tests/unit/calendario-filtros.test.ts).
 *
 * O QUE CADA FILTRO OLHA (e por que alguns parecem não achar nada):
 *   • cliente    — o cliente da OS;
 *   • tipo de OS — o tipo da ATIVIDADE agendada. A OS em si não tem tipo (ele é da atividade), então
 *                  uma OS que está no calendário pela data prevista, sem atividade no período, não
 *                  casa com NENHUM tipo. É a regra, não um defeito;
 *   • número     — trecho do número da OS (ou do número do chamado, quando é do portal);
 *   • unidade    — a unidade/local da OS, por id do cadastro (não mais por texto digitado);
 *   • técnico    — o responsável pela atividade OU qualquer membro da equipe dela;
 *   • status e prioridade — os da OS; vazio quer dizer "todos".
 *
 * Vários filtros juntos são E (todos têm de casar); vários valores do mesmo filtro são OU.
 */

/** O que o painel mantém: um filtro vazio ("", [] ) quer dizer "todos". */
export interface FiltrosCalendario {
  clienteId: string;
  tipos: string[];
  numero: string;
  unidadeId: string;
  tecnicoId: string;
  status: string[];
  prioridade: string[];
}

export const FILTROS_VAZIOS: FiltrosCalendario = {
  clienteId: "", tipos: [], numero: "", unidadeId: "", tecnicoId: "", status: [], prioridade: [],
};

/** As chaves na URL, na ordem em que aparecem na faixa. */
export const CHAVES_FILTRO = ["clienteId", "tipos", "numero", "unidadeId", "tecnicoId", "status", "prioridade"] as const;

/** O mínimo de um cartão para ser filtrado (o cartão inteiro vive em calendario-grid.tsx). */
export interface CardFiltravel {
  clienteId: string;
  tipoOsId: string | null;
  numero: string;
  unidadeId: string | null;
  tecnicoId: string | null;
  tecnicoIds?: string[];
  status: string;
  prioridade: string;
}

const texto = (v: string) => v.trim().toLowerCase();

/** Um cartão corresponde aos filtros? (E entre filtros, OU dentro do mesmo filtro.) */
export function cardCasa(c: CardFiltravel, f: FiltrosCalendario): boolean {
  if (f.clienteId && c.clienteId !== f.clienteId) return false;
  // O tipo é da ATIVIDADE: OS sem atividade no período não casa com tipo nenhum
  if (f.tipos.length && !(c.tipoOsId && f.tipos.includes(c.tipoOsId))) return false;
  const numero = texto(f.numero);
  if (numero && !c.numero.toLowerCase().includes(numero)) return false;
  if (f.unidadeId && c.unidadeId !== f.unidadeId) return false;
  // Por técnico: o responsável OU qualquer membro da equipe da atividade
  if (f.tecnicoId && c.tecnicoId !== f.tecnicoId && !(c.tecnicoIds ?? []).includes(f.tecnicoId)) return false;
  if (f.status.length && !f.status.includes(c.status)) return false;
  if (f.prioridade.length && !f.prioridade.includes(c.prioridade)) return false;
  return true;
}

/** Quantos filtros estão em uso (é o número da pílula "N filtros ativos"). */
export function contarAtivos(f: FiltrosCalendario): number {
  return (f.clienteId ? 1 : 0) + (f.tipos.length ? 1 : 0) + (texto(f.numero) ? 1 : 0) +
    (f.unidadeId ? 1 : 0) + (f.tecnicoId ? 1 : 0) + (f.status.length ? 1 : 0) + (f.prioridade.length ? 1 : 0);
}

export const temFiltro = (f: FiltrosCalendario): boolean => contarAtivos(f) > 0;

/**
 * Lê os filtros da URL. `unidades` traduz o parâmetro ANTIGO (`unidade=` com o nome digitado, de
 * antes desta leva) para o id do cadastro, para um link guardado no favorito continuar funcionando.
 */
export function lerFiltrosDaUrl(
  sp: { get(k: string): string | null },
  unidades: { value: string; label: string }[] = [],
): FiltrosCalendario {
  const lista = (k: string) => (sp.get(k) ?? "").split(",").filter(Boolean);
  const antigo = (sp.get("unidade") ?? "").trim().toLowerCase();
  const porNome = antigo ? unidades.find((u) => u.label.toLowerCase() === antigo)?.value ?? "" : "";
  return {
    clienteId: sp.get("clienteId") ?? "",
    tipos: lista("tipos"),
    numero: sp.get("numero") ?? "",
    unidadeId: sp.get("unidadeId") ?? porNome,
    tecnicoId: sp.get("tecnicoId") ?? "",
    status: lista("status"),
    prioridade: lista("prioridade"),
  };
}

/** Grava os filtros nos parâmetros da URL (mês, ano, visão e dia ficam como estão). */
export function gravarFiltrosNaUrl(p: URLSearchParams, f: FiltrosCalendario): URLSearchParams {
  const aplica = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
  aplica("clienteId", f.clienteId);
  aplica("tipos", f.tipos.join(","));
  aplica("numero", f.numero.trim());
  aplica("unidadeId", f.unidadeId);
  aplica("tecnicoId", f.tecnicoId);
  aplica("status", f.status.join(","));
  aplica("prioridade", f.prioridade.join(","));
  p.delete("unidade"); // o parâmetro antigo sai da URL assim que é traduzido
  return p;
}
