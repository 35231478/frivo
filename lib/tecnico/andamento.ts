/**
 * ATIVIDADE ESQUECIDA EM ANDAMENTO — regras PURAS (aparelho, servidor e testes).
 *
 * O problema (visto no concorrente): a atividade de ontem continua "Em andamento" com 8 h no cronômetro, porque o
 * técnico esqueceu de concluir. Aqui:
 *  - o app AVISA o técnico quando a atividade passa de X horas em andamento (por empresa, padrão 4 h), quando o
 *    expediente do dia acaba com ela aberta e quando ela começou em outro dia — calculado no aparelho, sem sinal;
 *  - o gestor vê no sino as atividades em andamento há mais de X horas (ou desde outro dia);
 *  - ao CONCLUIR com tempo suspeito, o app sugere o horário real de término (a última gravação da atividade) e o
 *    técnico confirma ou corrige; o servidor só aceita um término entre o início e o toque de concluir.
 */
import { z } from "zod";
import { chaveDiaBR, horaBR, partesBR } from "@/lib/fuso";
import { JORNADA_PADRAO, type Expediente, type Jornada } from "@/lib/atendimento/prazo";

export const ALERTA_HORAS_PADRAO = 4;
export const ALERTA_HORAS_MIN = 1;
export const ALERTA_HORAS_MAX = 24;
const MIN = 60_000;
const H = 60 * MIN;
/** Folga para relógio de aparelho levemente adiantado (término "depois" do toque por segundos não é recusado) */
export const FOLGA_TERMINO_MS = 2 * MIN;

/** Limite configurado pela empresa, sempre dentro da faixa (valor estranho no banco = padrão). */
export function limiteHoras(v: unknown): number {
  const n = typeof v === "number" && Number.isInteger(v) ? v : NaN;
  return n >= ALERTA_HORAS_MIN && n <= ALERTA_HORAS_MAX ? n : ALERTA_HORAS_PADRAO;
}
export const limiteHorasSchema = z.number().int("Use horas inteiras.").min(ALERTA_HORAS_MIN, `No mínimo ${ALERTA_HORAS_MIN} hora.`).max(ALERTA_HORAS_MAX, `No máximo ${ALERTA_HORAS_MAX} horas.`);

/** Quando a atividade começou: a coluna nova; para as antigas (sem ela), a hora agendada. */
export function inicioDaAtividade(a: { iniciadaEm?: Date | string | null; dataAgendada?: Date | string | null }): Date | null {
  const v = a.iniciadaEm ?? a.dataAgendada ?? null;
  return v ? new Date(v) : null;
}

/** O expediente de hoje (Brasília) na jornada da empresa; null = dia sem expediente. */
export function expedienteDoDia(jornada: Jornada | null | undefined, agora: Date | number): Expediente | null {
  return (jornada ?? JORNADA_PADRAO)[partesBR(agora).diaSemana] ?? null;
}

export type MotivoAlerta = "outro-dia" | "fim-do-dia" | "limite";
export interface SituacaoAndamento {
  alerta: MotivoAlerta | null;
  /** Minutos desde o início (0 sem início conhecido) */
  minutos: number;
}

/**
 * A atividade em andamento merece aviso ao técnico? Prioridade: começou em OUTRO DIA > o expediente de hoje
 * ACABOU > passou do LIMITE de horas. Só vale para EM_ANDAMENTO; sem início conhecido, nada.
 */
export function situacaoAndamento(p: {
  status: string; inicio: Date | string | null; agora: Date | number; limiteHoras: number; jornada?: Jornada | null;
}): SituacaoAndamento {
  if (p.status !== "EM_ANDAMENTO" || !p.inicio) return { alerta: null, minutos: 0 };
  const inicio = new Date(p.inicio).getTime();
  const agora = typeof p.agora === "number" ? p.agora : p.agora.getTime();
  const minutos = Math.max(0, Math.floor((agora - inicio) / MIN));
  if (chaveDiaBR(inicio) < chaveDiaBR(agora)) return { alerta: "outro-dia", minutos };
  const exp = expedienteDoDia(p.jornada, agora);
  const { hora, minuto } = partesBR(agora);
  if (exp && hora * 60 + minuto >= exp.fim) return { alerta: "fim-do-dia", minutos };
  if (agora - inicio >= limiteHoras(p.limiteHoras) * H) return { alerta: "limite", minutos };
  return { alerta: null, minutos };
}

/** "45 min", "5 h", "5 h 10 min" */
export function duracaoTexto(minutos: number): string {
  const h = Math.floor(minutos / 60), m = minutos % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A frase do aviso ao técnico (curta, sem exclamação). */
export function textoAlerta(s: SituacaoAndamento): string | null {
  if (!s.alerta) return null;
  if (s.alerta === "outro-dia") return "Começou em outro dia e continua em andamento.";
  if (s.alerta === "fim-do-dia") return `Expediente encerrado. Em andamento há ${duracaoTexto(s.minutos)}.`;
  return `Em andamento há ${duracaoTexto(s.minutos)}.`;
}

/* ───────── conclusão com tempo suspeito ───────── */

/** Concluir agora é suspeito? Passou do limite de horas desde o início, ou virou o dia. */
export function tempoSuspeito(inicio: Date | string | null, toque: Date | number, limite: number): boolean {
  if (!inicio) return false;
  const i = new Date(inicio).getTime();
  const t = typeof toque === "number" ? toque : toque.getTime();
  return t - i >= limiteHoras(limite) * H || chaveDiaBR(i) < chaveDiaBR(t);
}

/**
 * O término sugerido: a ÚLTIMA GRAVAÇÃO da atividade (resposta, foto, material…), se ficou entre o início e o
 * toque de concluir. Sem gravação nesse intervalo: nenhuma sugestão (o técnico informa).
 */
export function sugerirTermino(inicio: Date | string | null, ultimaGravacao: Date | string | null | undefined, toque: Date | number): Date | null {
  if (!inicio || !ultimaGravacao) return null;
  const i = new Date(inicio).getTime(), u = new Date(ultimaGravacao).getTime();
  const t = typeof toque === "number" ? toque : toque.getTime();
  return u >= i && u <= t ? new Date(u) : null;
}

/** A última gravação: a maior entre as datas dadas (inválidas e vazias não contam). */
export function ultimaDe(datas: (Date | string | null | undefined)[]): Date | null {
  let max = -Infinity;
  for (const d of datas) { const n = d ? new Date(d).getTime() : NaN; if (Number.isFinite(n) && n > max) max = n; }
  return Number.isFinite(max) ? new Date(max) : null;
}

/** O término informado vale? Entre o início e o toque de concluir (com a folga do relógio). */
export function terminoValido(termino: Date | string, inicio: Date | string | null, toque: Date | number): boolean {
  const x = new Date(termino).getTime();
  const t = typeof toque === "number" ? toque : toque.getTime();
  if (!Number.isFinite(x)) return false;
  if (inicio && x < new Date(inicio).getTime()) return false;
  return x <= t + FOLGA_TERMINO_MS;
}

/** "HH:MM" digitado no dia de `base` (Brasília) → instante; inválido = null. */
export function horarioNoDia(hhmm: string, base: Date | number): Date | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return null;
  const b = partesBR(base);
  // Brasília é UTC−3 o ano todo (sem horário de verão desde 2019)
  return new Date(Date.UTC(b.ano, b.mes, b.dia, Number(m[1]) + 3, Number(m[2])));
}

export const MSG_TERMINO_FORA = "O horário de término precisa ficar entre o início da atividade e agora.";
export const historicoTermino = (termino: Date, toque: Date) =>
  `Término informado pelo técnico: ${horaBR(termino)}${chaveDiaBR(termino) !== chaveDiaBR(toque) ? ` de ${chaveDiaBR(termino).split("-").reverse().join("/")}` : ""} (concluída no app às ${horaBR(toque)})`;

/** Início de uma atividade que passa a EM_ANDAMENTO (vindo de outro status): grava agora; senão não mexe. */
export function marcaDeInicio(antes: string, depois: string, quando: Date = new Date()): { iniciadaEm?: Date } {
  return depois === "EM_ANDAMENTO" && antes !== "EM_ANDAMENTO" ? { iniciadaEm: quando } : {};
}
