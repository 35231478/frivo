/**
 * Posição do técnico (Operações › Mapa) — regras PURAS, usadas pelo servidor, pelo app do técnico e
 * pela tela do mapa.
 *
 *  - O que é uma LEITURA: latitude, longitude, precisão, bateria (quando o aparelho informa), o horário
 *    em que foi feita no aparelho e o que a disparou.
 *  - O servidor guarda só a ÚLTIMA leitura de cada técnico (a mais nova vence; uma leitura antiga que
 *    chega depois — fila de quem estava sem sinal — não sobrescreve a mais nova).
 *  - FRESCOR: o mapa mostra a última posição CONHECIDA, não a atual. Quanto mais velha, menos ela
 *    parece tempo real: "atual" (até 15 min), "recente" (até 3 h), "antiga" (depois disso: cinza).
 *
 * Pronto para o app nativo: ele manda leituras no MESMO formato, com `origem: "NATIVO"` e o motivo
 * SEGUNDO_PLANO, várias por envio. Nada aqui nem na tela muda — só passam a chegar mais leituras.
 */
import { z } from "zod";
import { chaveDiaBR, horaBR } from "@/lib/fuso";

/** O que disparou a leitura. SEGUNDO_PLANO é do app nativo (o app web só lê com a tela aberta). */
export const MOTIVOS_POSICAO = ["ABRIU_APP", "CHEGUEI", "INICIO", "CONCLUSAO", "SINCRONIZACAO", "PERIODICO", "SEGUNDO_PLANO"] as const;
export type MotivoPosicao = (typeof MOTIVOS_POSICAO)[number];

export const ORIGENS_POSICAO = ["PWA", "NATIVO"] as const;
export type OrigemPosicao = (typeof ORIGENS_POSICAO)[number];

/** Uma leitura, como o aparelho manda */
export const leituraSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Raio de precisão em metros */
  precisao: z.number().min(0).max(1_000_000).nullable().optional(),
  /** 0–100; null/ausente = o aparelho não informa */
  bateria: z.number().int().min(0).max(100).nullable().optional(),
  carregando: z.boolean().nullable().optional(),
  /** Horário da leitura no relógio do aparelho (ISO) */
  em: z.string().max(40),
  motivo: z.enum(MOTIVOS_POSICAO),
}).strict();
export type Leitura = z.infer<typeof leituraSchema>;

/** Quantas leituras cabem num envio (o app web manda poucas; o nativo, um lote) */
export const MAX_LEITURAS_POR_ENVIO = 200;

/** Um envio: as leituras (em qualquer ordem) e o relógio do aparelho na hora do envio */
export const envioPosicoesSchema = z.object({
  posicoes: z.array(leituraSchema).min(1).max(MAX_LEITURAS_POR_ENVIO),
  /** Relógio do aparelho ao enviar: com ele o servidor mede há quanto tempo cada leitura foi feita */
  agora: z.string().max(40).optional(),
  origem: z.enum(ORIGENS_POSICAO).optional(),
}).strict();
export type EnvioPosicoes = z.infer<typeof envioPosicoesSchema>;

/** A leitura mais nova de um lote (pelo horário do aparelho; horário inválido perde). */
export function maisNova<T extends { em: string }>(leituras: T[]): T | null {
  let melhor: T | null = null;
  let quando = -Infinity;
  for (const l of leituras) {
    const t = Date.parse(l.em);
    const v = Number.isFinite(t) ? t : -Infinity;
    if (!melhor || v > quando) { melhor = l; quando = v; }
  }
  return melhor;
}

/* ───────── frescor ───────── */

/** Até aqui a posição é tratada como "de agora" */
export const LIMITE_ATUAL_MS = 15 * 60_000;
/** Passou disto, a posição é ANTIGA: aparece cinza, com o horário, para não parecer tempo real */
export const LIMITE_ANTIGA_MS = 3 * 60 * 60_000;

export type Frescor = "atual" | "recente" | "antiga";

export function frescor(registradoEm: string | Date, agora: number = Date.now()): Frescor {
  const idade = agora - new Date(registradoEm).getTime();
  if (!(idade <= LIMITE_ANTIGA_MS)) return "antiga"; // inclui data inválida
  return idade <= LIMITE_ATUAL_MS ? "atual" : "recente";
}

/** "agora", "há 5 min", "há 1 h 20 min", "há 3 h", "há 2 dias" */
export function haQuanto(registradoEm: string | Date, agora: number = Date.now()): string {
  const min = Math.floor(Math.max(0, agora - new Date(registradoEm).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 3) return min % 60 ? `há ${h} h ${min % 60} min` : `há ${h} h`;
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** "visto às 14:02" — ou, se não foi hoje (Brasília), "visto em 10/11 às 17:42" */
export function vistoAs(registradoEm: string | Date, agora: number = Date.now()): string {
  const quando = new Date(registradoEm);
  if (chaveDiaBR(quando) === chaveDiaBR(agora)) return `visto às ${horaBR(quando)}`;
  const [, mes, dia] = chaveDiaBR(quando).split("-");
  return `visto em ${dia}/${mes} às ${horaBR(quando)}`;
}

/** "visto às 14:02 · há 5 min" */
export const textoVisto = (registradoEm: string | Date, agora: number = Date.now()) =>
  `${vistoAs(registradoEm, agora)} · ${haQuanto(registradoEm, agora)}`;

/* ───────── o que a tela mostra ───────── */

/** "82%", "82% · carregando" — ou "—" quando o aparelho não informa (nunca um número inventado) */
export function textoBateria(bateria: number | null | undefined, carregando?: boolean | null): string {
  if (typeof bateria !== "number" || !Number.isFinite(bateria)) return "—";
  return `${Math.round(bateria)}%${carregando ? " · carregando" : ""}`;
}

/** "-23,550520, -46,633308" */
export const textoCoordenadas = (lat: number, lng: number) => `${lat.toFixed(6).replace(".", ",")}, ${lng.toFixed(6).replace(".", ",")}`;

/** "±12 m", "±1,2 km" — ou "" quando o aparelho não informa */
export function textoPrecisao(precisaoM: number | null | undefined): string {
  if (typeof precisaoM !== "number" || !Number.isFinite(precisaoM)) return "";
  return precisaoM < 1000 ? `±${Math.round(precisaoM)} m` : `±${(precisaoM / 1000).toFixed(1).replace(".", ",")} km`;
}

/** Link que abre o ponto no Google Maps (para quem quiser a rota até o técnico) */
export const linkNoMapa = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** As iniciais do marcador: "Carlos Oliveira" → "CO"; "Ana" → "AN" */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  const letras = partes.length === 1 ? partes[0].slice(0, 2) : partes[0][0] + partes[partes.length - 1][0];
  return letras.toUpperCase();
}

/* ───────── o que o mapa recebe ───────── */

/** A OS em que o técnico está (em andamento; ou a que ele acabou de chegar) */
export interface OsNoMapa { osId: string; numero: string; atividadeId: string; titulo: string; cliente: string; situacao: "EM_ANDAMENTO" | "NO_LOCAL" }

export interface PosicaoNoMapa {
  lat: number; lng: number; precisaoM: number | null;
  bateria: number | null; carregando: boolean | null;
  registradoEm: string; motivo: string; origem: string;
}

export interface TecnicoNoMapa { id: string; nome: string; os: OsNoMapa | null; posicao: PosicaoNoMapa | null }

export interface RespostaMapa {
  /** "Rastrear localização dos técnicos" ligado na empresa? Desligado: nenhuma posição sai do servidor */
  rastreio: boolean;
  /** Técnicos de campo ativos — com `posicao` (vão para o mapa) ou sem (lista "sem localização") */
  tecnicos: TecnicoNoMapa[];
  geradoEm: string;
}

/** Ordem da lista: os vistos há menos tempo primeiro; sem posição no fim, por nome */
export function ordenarParaLista(tecnicos: TecnicoNoMapa[]): TecnicoNoMapa[] {
  const quando = (t: TecnicoNoMapa) => (t.posicao ? Date.parse(t.posicao.registradoEm) : -Infinity);
  return [...tecnicos].sort((a, b) => quando(b) - quando(a) || a.nome.localeCompare(b.nome, "pt-BR"));
}
