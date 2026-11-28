/**
 * App pronto pra janeiro 2 — regras PURAS de dois avisos do Meu dia:
 *
 * D9 — "SAIU DO SEU DIA": a OS que estava no dia do técnico e o escritório cancelou, reagendou ou passou a outro
 * técnico não some calada. O aparelho manda os ids que tinha hoje (cabeçalho); o servidor diz quais saíram e por quê; a faixa
 * fica até o técnico dispensar. O que o próprio técnico fez (ex.: "não concluída") não vira aviso.
 *
 * D11 — GRAVAÇÕES NO OUTRO APARELHO: cada aparelho conta ao servidor quantas gravações ainda tem na fila (a cada Meu
 * dia e a cada envio); o aparelho novo avisa quando o outro deu notícia de gravação sem enviar. É a última notícia
 * que o outro deu: o que ele gravou sem sinal e nunca chegou a contar, o servidor não tem como saber.
 */

/* ───────── D9 ───────── */

export type MotivoSaida = "cancelada" | "reagendada" | "outro-tecnico" | "retirada";
export interface SaidaDoDia { atividadeId: string; osNumero: string; motivo: MotivoSaida; novaData: string | null }
/** Até quantos ids o aparelho manda (o dia de um técnico cabe folgado) */
export const MAX_IDS_SAIDA = 60;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Os ids do cabeçalho "antes" (só o formato de id; repetidos saem; no máximo MAX_IDS_SAIDA) */
export function idsDoAntes(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return [...new Set(texto.split(",").map((x) => x.trim()).filter((x) => ID.test(x)))].slice(0, MAX_IDS_SAIDA);
}

/** Os ids que o aparelho tinha no dia de HOJE (concluídas e canceladas não contam: não "somem") */
export function idsParaConferir(guardado: { dia?: string | null; atividades?: { atividadeId: string; status: string }[] } | null | undefined, hoje: string): string[] {
  if (!guardado || guardado.dia !== hoje) return [];
  return (guardado.atividades ?? []).filter((c) => c.status !== "CONCLUIDA" && c.status !== "CANCELADA").map((c) => c.atividadeId).slice(0, MAX_IDS_SAIDA);
}

/** Por que saiu (null = não saiu, ou foi o próprio técnico) */
export function motivoDaSaida(a: {
  status: string; osStatus: string; noMeuDia: boolean; doTecnico: boolean; diaAgendado: string | null; hoje: string; mudouPorMim: boolean;
}): MotivoSaida | null {
  if (a.noMeuDia || a.mudouPorMim) return null;
  if (a.status === "CANCELADA" || a.osStatus === "CANCELADA") return "cancelada";
  if (!a.doTecnico) return "outro-tecnico";
  if (a.diaAgendado !== a.hoje) return "reagendada";
  return "retirada";
}

const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
export function textoSaida(s: SaidaDoDia): string {
  const porque = s.motivo === "cancelada" ? "cancelada pelo escritório"
    : s.motivo === "reagendada" ? (s.novaData ? `reagendada pelo escritório para ${diaCurto(s.novaData)}` : "reagendada pelo escritório, ainda sem data")
      : s.motivo === "outro-tecnico" ? "passou para outro técnico" : "retirada do seu dia pelo escritório";
  return `Saiu do seu dia: ${s.osNumero} (${porque})`;
}

/** As faixas guardadas no aparelho: as novas entram (sem repetir a mesma OS); as de outro dia saem */
export interface FaixasSaida { dia: string; itens: SaidaDoDia[] }
export function juntarSaidas(g: FaixasSaida | null | undefined, hoje: string, novas: readonly SaidaDoDia[]): FaixasSaida {
  const atuais = g?.dia === hoje ? g.itens : [];
  const ja = new Set(atuais.map((s) => s.atividadeId));
  return { dia: hoje, itens: [...atuais, ...novas.filter((s) => !ja.has(s.atividadeId))] };
}
export const dispensarSaida = (g: FaixasSaida, atividadeId: string): FaixasSaida => ({ ...g, itens: g.itens.filter((s) => s.atividadeId !== atividadeId) });
export const CHAVE_SAIDAS = "saiuDoDia";

/* ───────── D11 ───────── */

export const CHAVE_FILA_APARELHOS = "app:filaPorAparelho";
export const CABECALHO_APARELHO = "x-frivo-aparelho";
/** D9 — os ids que o aparelho tinha hoje (no cabeçalho: a URL do Meu dia fica a mesma) */
export const CABECALHO_ANTES = "x-frivo-antes";
export const CABECALHO_FILA = "x-frivo-fila";
/** Notícia de mais de 14 dias não vale mais aviso; guarda no máximo 5 aparelhos por usuário */
export const DIAS_NOTICIA = 14;
const MAX_APARELHOS = 5;
const APARELHO = /^[A-Za-z0-9-]{8,64}$/;

export type FilaPorAparelho = Record<string, { n: number; em: string }>;

/** O que o aparelho contou nos cabeçalhos (inválido = nada) */
export function lerNoticia(aparelho: string | null | undefined, fila: string | null | undefined): { aparelho: string; pendentes: number } | null {
  if (!aparelho || !APARELHO.test(aparelho) || fila == null || !/^\d{1,6}$/.test(fila)) return null;
  return { aparelho, pendentes: Number(fila) };
}

/** A notícia nova no mapa guardado: os mais recentes ficam (no máximo MAX_APARELHOS) */
export function comNoticia(mapa: unknown, aparelho: string, pendentes: number, agora: Date): FilaPorAparelho {
  const atual: FilaPorAparelho = {};
  if (mapa && typeof mapa === "object" && !Array.isArray(mapa)) {
    for (const [k, v] of Object.entries(mapa as Record<string, unknown>)) {
      const x = v as { n?: unknown; em?: unknown };
      if (APARELHO.test(k) && typeof x?.n === "number" && typeof x?.em === "string") atual[k] = { n: x.n, em: x.em };
    }
  }
  atual[aparelho] = { n: Math.max(0, Math.floor(pendentes)), em: agora.toISOString() };
  return Object.fromEntries(Object.entries(atual).sort((a, b) => (a[1].em < b[1].em ? 1 : -1)).slice(0, MAX_APARELHOS));
}

/** Outro aparelho deu notícia de gravação sem enviar (a mais recente), nos últimos DIAS_NOTICIA dias? */
export function pendenciaNoOutro(mapa: FilaPorAparelho | null | undefined, aparelho: string | null, agora: Date): { pendentes: number; em: string } | null {
  if (!mapa || !aparelho) return null;
  const limite = agora.getTime() - DIAS_NOTICIA * 86_400_000;
  const outros = Object.entries(mapa).filter(([k, v]) => k !== aparelho && v.n > 0 && Date.parse(v.em) >= limite).sort((a, b) => (a[1].em < b[1].em ? 1 : -1));
  return outros.length ? { pendentes: outros[0][1].n, em: outros[0][1].em } : null;
}

export function textoOutroAparelho(o: { pendentes: number; em: string; umAparelho: boolean }, horaBR: (iso: string) => string): string {
  const qtd = o.pendentes === 1 ? "1 gravação" : `${o.pendentes} gravações`;
  const como = o.umAparelho
    ? "Para não perder: abra o app nele com sinal e entre de novo; ele envia sozinho (ao entrar lá, este aparelho sai)."
    : "Para não perder: abra o app nele com sinal; ele envia sozinho.";
  return `O outro aparelho tem ${qtd} que ainda não ${o.pendentes === 1 ? "subiu" : "subiram"} (última notícia dele: ${horaBR(o.em)}). ${como}`;
}
