/**
 * PRAZO DE ATENDIMENTO — o que o contrato de manutenção promete ao cliente ("comparecer em 4 h",
 * "resolver em 24 h"). Regras puras (sem banco). Não é o prazo de execução da OS: aquele é o
 * compromisso interno com o técnico (lib/os/prazo-execucao.ts); este é a promessa ao cliente.
 *
 *   • Conta da ABERTURA DO CHAMADO pelo cliente — não da criação da OS.
 *   • É do contrato, por prioridade do chamado (as cinco que a OS já tem); o contrato configura só
 *     as que quiser prometer, e cada linha pode ter só o comparecimento, só a resolução ou os dois.
 *   • Horas corridas ou, com "só em horário comercial", só as horas de dentro do expediente.
 *   • Os limites são calculados UMA vez, na abertura, e ficam gravados na OS: mudar o contrato depois
 *     não reescreve o que já foi prometido.
 *   • Só o chamado de cliente em contrato tem prazo de atendimento. A preventiva recorrente não: é
 *     a empresa que agenda, não há chamado para contar.
 */
import { z } from "zod";
import { instanteBR, partesBR } from "@/lib/fuso";

/* ───────── o que o contrato promete ───────── */

export const PRIORIDADES = ["BAIXA", "NORMAL", "ALTA", "URGENTE", "CRITICO"] as const;
export type PrioridadeOs = (typeof PRIORIDADES)[number];

export interface RegraAtendimento {
  prioridade: string;
  comparecerHoras: number | null;
  resolverHoras: number | null;
  soHorarioComercial: boolean;
}

export const HORAS_MAX = 24 * 365;
export const MSG_REGRA_VAZIA = "Informe ao menos um prazo: comparecer ou resolver.";
export const MSG_RESOLVER_ANTES = "O prazo para resolver não pode ser menor que o de comparecer.";
export const MSG_PRIORIDADE_REPETIDA = "Cada prioridade só pode ter um prazo de atendimento.";

const horas = (nome: string) => z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.number({ invalid_type_error: `${nome}: informe um número de horas.` }).int(`${nome}: use horas inteiras.`)
    .min(1, `${nome}: mínimo 1 hora.`).max(HORAS_MAX, `${nome}: no máximo ${HORAS_MAX} horas.`).nullable(),
);

/** Uma linha do contrato: a prioridade e as horas que ela promete */
export const regraAtendimentoSchema = z.object({
  prioridade: z.enum(PRIORIDADES, { errorMap: () => ({ message: "Prioridade inválida." }) }),
  comparecerHoras: horas("Comparecer"),
  resolverHoras: horas("Resolver"),
  soHorarioComercial: z.boolean().default(false),
}).superRefine((r, ctx) => {
  if (r.comparecerHoras == null && r.resolverHoras == null) ctx.addIssue({ code: "custom", path: ["comparecerHoras"], message: MSG_REGRA_VAZIA });
  if (r.comparecerHoras != null && r.resolverHoras != null && r.resolverHoras < r.comparecerHoras)
    ctx.addIssue({ code: "custom", path: ["resolverHoras"], message: MSG_RESOLVER_ANTES });
});

/** As linhas do contrato: no máximo uma por prioridade */
export const regrasAtendimentoSchema = z.array(regraAtendimentoSchema).max(PRIORIDADES.length).superRefine((regras, ctx) => {
  const vistas = new Set<string>();
  regras.forEach((r, i) => {
    if (vistas.has(r.prioridade)) ctx.addIssue({ code: "custom", path: [i, "prioridade"], message: MSG_PRIORIDADE_REPETIDA });
    vistas.add(r.prioridade);
  });
});

/**
 * A promessa do contrato para um chamado desta prioridade. Só a linha da PRÓPRIA prioridade vale:
 * prioridade que o contrato não configurou não tem prazo de atendimento (não se herda de outra).
 */
export function regraDaPrioridade(regras: RegraAtendimento[], prioridade: string): RegraAtendimento | null {
  return regras.find((r) => r.prioridade === prioridade) ?? null;
}

/* ───────── horas corridas e horas de expediente ───────── */

/**
 * O horário comercial que "só em horário comercial" usa: segunda a sexta, das 8h às 18h de
 * Brasília. Fixo por enquanto — o horário por empresa e os feriados ficam para uma etapa posterior.
 */
export const HORARIO_COMERCIAL = { inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5] as readonly number[] } as const;
export const ROTULO_HORARIO_COMERCIAL = "segunda a sexta, das 8h às 18h";

const MIN = 60_000;

/** O início do próximo expediente a partir de `d` (o próprio `d` se já estiver dentro de um). */
function inicioDoExpediente(d: Date): Date {
  let p = partesBR(d);
  for (let i = 0; i < 8; i++) {
    const util = HORARIO_COMERCIAL.dias.includes(p.diaSemana);
    if (util && p.hora < HORARIO_COMERCIAL.inicio) return instanteBR(p.ano, p.mes, p.dia, HORARIO_COMERCIAL.inicio);
    if (util && p.hora < HORARIO_COMERCIAL.fim) return d;
    // depois do expediente (ou dia sem expediente): o começo do dia seguinte
    d = instanteBR(p.ano, p.mes, p.dia + 1, 0);
    p = partesBR(d);
  }
  return d;
}

/**
 * `inicio` + `horas`. Corridas: o relógio. Só em horário comercial: conta apenas os minutos dentro
 * do expediente — chamado aberto sexta às 17h com prazo de 4 h vence segunda às 11h.
 */
export function somarHoras(inicio: Date, horas: number, soHorarioComercial = false): Date {
  if (!soHorarioComercial) return new Date(inicio.getTime() + horas * 60 * MIN);
  let restante = horas * 60 * MIN;
  let cursor = inicioDoExpediente(inicio);
  for (let i = 0; i < 2000; i++) {
    const p = partesBR(cursor);
    const fim = instanteBR(p.ano, p.mes, p.dia, HORARIO_COMERCIAL.fim);
    const disponivel = fim.getTime() - cursor.getTime();
    if (restante <= disponivel) return new Date(cursor.getTime() + restante);
    restante -= disponivel;
    cursor = inicioDoExpediente(instanteBR(p.ano, p.mes, p.dia + 1, 0));
  }
  return cursor;
}

/** Os dois limites de um chamado aberto em `abertoEm`, pela regra da prioridade dele. */
export function limitesDoAtendimento(abertoEm: Date, regra: RegraAtendimento | null): { comparecerAte: Date | null; resolverAte: Date | null } {
  if (!regra) return { comparecerAte: null, resolverAte: null };
  return {
    comparecerAte: regra.comparecerHoras != null ? somarHoras(abertoEm, regra.comparecerHoras, regra.soHorarioComercial) : null,
    resolverAte: regra.resolverHoras != null ? somarHoras(abertoEm, regra.resolverHoras, regra.soHorarioComercial) : null,
  };
}

/* ───────── quais OS têm prazo de atendimento ───────── */

/**
 * Só o CHAMADO DE CLIENTE em CONTRATO: a OS precisa estar ligada a um contrato e ter a abertura do
 * chamado registrada (o portal e o QR registram sozinhos; a OS lançada à mão registra quando é
 * marcada como chamado). A preventiva recorrente fica de fora — ninguém abriu chamado.
 */
export function temPrazoDeAtendimento(os: { contratoId?: string | null; origem?: string | null; chamadoAbertoEm?: Date | string | null }): boolean {
  return !!os.contratoId && !!os.chamadoAbertoEm && os.origem !== "RECORRENTE";
}

/* ───────── a situação de um prazo, agora ───────── */

export type SituacaoAtendimento = "SEM_PRAZO" | "NO_PRAZO" | "VENCENDO" | "ESTOURADO" | "CUMPRIDO" | "CUMPRIDO_FORA";

/** Avisa antes de estourar: quando falta 20% do prazo ou menos — e nunca menos que 1 hora de aviso */
export const ALERTA_FRACAO = 0.2;
export const ALERTA_MINIMO_MIN = 60;

export interface PrazoAtendimento { situacao: SituacaoAtendimento; limite: Date | null; cumpridoEm: Date | null; minutos: number }

/**
 * Situação de UM prazo (comparecer ou resolver). `minutos`: quanto falta (NO_PRAZO, VENCENDO), há
 * quanto estourou (ESTOURADO) ou com quanto de atraso foi cumprido (CUMPRIDO_FORA).
 */
export function situacaoAtendimento(o: { limite: Date | string | null | undefined; cumpridoEm?: Date | string | null; abertoEm?: Date | string | null }, agora: Date = new Date()): PrazoAtendimento {
  const limite = o.limite ? new Date(o.limite) : null;
  const cumpridoEm = o.cumpridoEm ? new Date(o.cumpridoEm) : null;
  if (!limite) return { situacao: "SEM_PRAZO", limite: null, cumpridoEm, minutos: 0 };
  if (cumpridoEm) {
    const atraso = Math.ceil((cumpridoEm.getTime() - limite.getTime()) / MIN);
    return atraso > 0 ? { situacao: "CUMPRIDO_FORA", limite, cumpridoEm, minutos: atraso } : { situacao: "CUMPRIDO", limite, cumpridoEm, minutos: 0 };
  }
  const falta = Math.floor((limite.getTime() - agora.getTime()) / MIN);
  if (falta < 0) return { situacao: "ESTOURADO", limite, cumpridoEm: null, minutos: -falta };
  const total = o.abertoEm ? (limite.getTime() - new Date(o.abertoEm).getTime()) / MIN : 0;
  const aviso = Math.max(ALERTA_MINIMO_MIN, total * ALERTA_FRACAO);
  return { situacao: falta <= aviso ? "VENCENDO" : "NO_PRAZO", limite, cumpridoEm: null, minutos: falta };
}

/** "40 min", "3 h", "1 h 30 min", "2 dias" — a duração dita como uma pessoa diria */
export function duracaoCurta(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) {
    const h = Math.floor(m / 60), resto = m % 60;
    return resto && h < 6 ? `${h} h ${resto} min` : `${h} h`;
  }
  return `${Math.floor(m / (24 * 60))} dias`;
}

/** "faltam 3 h", "estourou há 40 min", "cumprido no prazo", "cumprido com 2 h de atraso" */
export function textoAtendimento(p: PrazoAtendimento): string {
  switch (p.situacao) {
    case "NO_PRAZO": case "VENCENDO": return p.minutos < 1 ? "vence agora" : `${p.minutos < 60 ? "faltam" : p.minutos < 120 ? "falta" : "faltam"} ${duracaoCurta(p.minutos)}`;
    case "ESTOURADO": return `estourou há ${duracaoCurta(p.minutos)}`;
    case "CUMPRIDO": return "cumprido no prazo";
    case "CUMPRIDO_FORA": return `cumprido com ${duracaoCurta(p.minutos)} de atraso`;
    default: return "sem prazo";
  }
}

/** Os dois prazos de atendimento de uma OS, lidos do que ficou gravado nela. */
export function atendimentoDaOs(os: {
  chamadoAbertoEm?: Date | string | null;
  atendimentoComparecerAte?: Date | string | null; atendimentoResolverAte?: Date | string | null;
  atendimentoComparecidoEm?: Date | string | null; dataConclusao?: Date | string | null; status?: string;
}, agora: Date = new Date()): { comparecer: PrazoAtendimento; resolver: PrazoAtendimento } {
  return {
    comparecer: situacaoAtendimento({ limite: os.atendimentoComparecerAte, cumpridoEm: os.atendimentoComparecidoEm, abertoEm: os.chamadoAbertoEm }, agora),
    // resolvido = a OS concluída (a data de conclusão só vale com a OS concluída: reabrir a OS reabre o prazo)
    resolver: situacaoAtendimento({ limite: os.atendimentoResolverAte, cumpridoEm: os.status === "CONCLUIDA" ? os.dataConclusao : null, abertoEm: os.chamadoAbertoEm }, agora),
  };
}
