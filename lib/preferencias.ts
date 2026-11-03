import { z } from "zod";

/**
 * Preferência pessoal de tela (PR B — tabelas profissionais). Pura: valida o que o navegador manda
 * e normaliza o que volta do banco/localStorage, para a tela nunca confiar num JSON torto.
 *
 * Chave: "tabela:<tela>" (ex.: "tabela:orcamentos"). Valor: { larguras: { coluna: px }, ocultas: [coluna] }.
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
  const igual = (ocultas === undefined ? p.ocultas === undefined : ocultas.length === p.ocultas!.length && ocultas.every((id, i) => id === p.ocultas![i]))
    && Object.keys(larguras).length === Object.keys(p.larguras).length && Object.entries(larguras).every(([id, px]) => p.larguras[id] === px);
  return igual ? p : ocultas ? { larguras, ocultas } : { larguras };
}

export const preferenciaVazia = (p: PreferenciaTabela) => Object.keys(p.larguras).length === 0 && p.ocultas === undefined;

/** As colunas escondidas que valem: a lista guardada pelo usuário ou, sem ela, as escondidas por padrão da tela */
export function ocultasEfetivas(p: PreferenciaTabela, colunas: (ColunaConhecida & { oculta?: boolean })[]): Set<string> {
  return new Set(p.ocultas ?? colunas.filter((c) => c.oculta).map((c) => c.id));
}
