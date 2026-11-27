import { z } from "zod";

/**
 * Preferência pessoal de tela (PR B — tabelas profissionais). Pura: valida o que o navegador manda
 * e normaliza o que volta do banco/localStorage, para a tela nunca confiar num JSON torto.
 *
 * Chave: "tabela:<tela>" (ex.: "tabela:orcamentos"). Valor: { larguras: { coluna: px }, ocultas: [coluna], ordem: [coluna] }.
 */
export const CHAVE_PREFERENCIA = /^tabela:[a-z0-9-]{1,60}$/;
export const chaveTabela = (tela: string) => `tabela:${tela}`;

/** Largura mínima e máxima de uma coluna, em px (a mínima é a do componente; a máxima evita JSON absurdo) */
export const LARGURA_MIN = 48;
export const LARGURA_MAX = 1600;
const MAX_COLUNAS = 80;

export const preferenciaTabelaSchema = z.object({
  larguras: z.record(z.string().min(1).max(60), z.number().int().min(LARGURA_MIN).max(LARGURA_MAX)).refine((o) => Object.keys(o).length <= MAX_COLUNAS, "Colunas demais"),
  /** Ausente = as colunas escondidas por padrão da tela; [] = todas visíveis */
  ocultas: z.array(z.string().min(1).max(60)).max(MAX_COLUNAS).optional(),
  /** A ordem das colunas que o usuário arrastou (ausente = a ordem da tela) */
  ordem: z.array(z.string().min(1).max(60)).max(MAX_COLUNAS).optional(),
}).strict();

export type PreferenciaTabela = z.infer<typeof preferenciaTabelaSchema>;

export const PREFERENCIA_VAZIA: PreferenciaTabela = { larguras: {} };

/** Interpreta um valor vindo do banco ou do localStorage; qualquer coisa torta vira "sem preferência". */
export function lerPreferenciaTabela(valor: unknown): PreferenciaTabela {
  const r = preferenciaTabelaSchema.safeParse(valor);
  return r.success ? r.data : PREFERENCIA_VAZIA;
}

/** O que a tela conhece de cada coluna, para a preferência não esconder o que não pode nem referir coluna que não existe */
export interface ColunaConhecida { id: string; minimo?: number; obrigatoria?: boolean }

/**
 * Casa a preferência com as colunas da tela: descarta colunas que não existem mais, respeita a largura
 * mínima de cada uma e nunca deixa uma coluna obrigatória escondida. Devolve o mesmo objeto se nada mudou.
 */
export function ajustarPreferencia(p: PreferenciaTabela, colunas: ColunaConhecida[]): PreferenciaTabela {
  const porId = new Map(colunas.map((c) => [c.id, c]));
  const larguras: Record<string, number> = {};
  for (const [id, px] of Object.entries(p.larguras)) {
    const c = porId.get(id);
    if (!c) continue;
    larguras[id] = Math.max(c.minimo ?? LARGURA_MIN, Math.min(LARGURA_MAX, Math.round(px)));
  }
  const ocultas = p.ocultas ? [...new Set(p.ocultas)].filter((id) => porId.has(id) && !porId.get(id)!.obrigatoria) : undefined;
  const ordem = p.ordem ? [...new Set(p.ordem)].filter((id) => porId.has(id)) : undefined;
  const mesmaLista = (a: string[] | undefined, b: string[] | undefined) =>
    a === undefined ? b === undefined : b !== undefined && a.length === b.length && a.every((id, i) => id === b[i]);
  const igual = mesmaLista(ocultas, p.ocultas) && mesmaLista(ordem, p.ordem)
    && Object.keys(larguras).length === Object.keys(p.larguras).length && Object.entries(larguras).every(([id, px]) => p.larguras[id] === px);
  return igual ? p : { larguras, ...(ocultas && { ocultas }), ...(ordem && { ordem }) };
}

export const preferenciaVazia = (p: PreferenciaTabela) => Object.keys(p.larguras).length === 0 && p.ocultas === undefined && p.ordem === undefined;

/**
 * As colunas na ordem do usuário. As colunas FIXAS (checkbox, ações) não se movem: ficam na posição em que
 * a tela as declarou, e as outras ocupam as demais posições na ordem guardada. Coluna que a preferência
 * não conhece (nova na tela) entra no lugar em que a tela a declarou, entre as vizinhas. Sem ordem, a da tela.
 */
export function ordenarColunas<T extends { id: string; fixa?: boolean }>(colunas: T[], ordem: string[] | undefined): T[] {
  if (!ordem?.length) return colunas;
  const moveis = colunas.filter((c) => !c.fixa);
  const posicao = new Map(ordem.map((id, i) => [id, i]));
  // Coluna desconhecida herda a posição da vizinha conhecida anterior (fica logo depois dela)
  let ultima = -1;
  const chave = moveis.map((c, i) => {
    const p = posicao.get(c.id);
    if (p !== undefined) ultima = p;
    return { c, k: p ?? ultima + 0.5, i };
  });
  const ordenadas = chave.sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.c);
  let j = 0;
  return colunas.map((c) => (c.fixa ? c : ordenadas[j++]));
}

/** Move a coluna `id` uma posição (−1 = para cima/esquerda, +1 = para baixo/direita) ou para o índice `para` */
export function moverColuna(ids: string[], id: string, para: number): string[] {
  const de = ids.indexOf(id);
  if (de < 0) return ids;
  const alvo = Math.max(0, Math.min(ids.length - 1, para));
  if (alvo === de) return ids;
  const novo = ids.filter((x) => x !== id);
  novo.splice(alvo, 0, id);
  return novo;
}

/** As colunas escondidas que valem: a lista guardada pelo usuário ou, sem ela, as escondidas por padrão da tela */
export function ocultasEfetivas(p: PreferenciaTabela, colunas: (ColunaConhecida & { oculta?: boolean })[]): Set<string> {
  return new Set(p.ocultas ?? colunas.filter((c) => c.oculta).map((c) => c.id));
}
