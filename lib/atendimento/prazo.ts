/**
 * PRAZO DE ATENDIMENTO — o que o contrato de manutenção promete ao cliente ("comparecer em 4 h",
 * "resolver em 24 h"). Regras puras (sem banco). Não é o prazo de execução da OS: aquele é o
 * compromisso interno com o técnico (lib/os/prazo-execucao.ts); este é a promessa ao cliente.
 *
 *   • Conta da ABERTURA DO CHAMADO pelo cliente — não da criação da OS.
 *   • É do contrato, por prioridade do chamado (as cinco que a OS já tem); o contrato configura só
 *     as que quiser prometer, e cada linha pode ter só o comparecimento, só a resolução ou os dois.
 *   • Horas corridas ou, com "só em horário comercial", só as horas de dentro do expediente — o da
 *     EMPRESA (a jornada semanal de Configurações › Horário comercial; sem configurar, seg–sex 8h–18h).
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

/** O expediente de um dia, em minutos desde a meia-noite (de Brasília) */
export interface Expediente { inicio: number; fim: number }
/**
 * A JORNADA SEMANAL da empresa: um expediente por dia da semana (0 = domingo … 6 = sábado); null =
 * dia sem expediente. É configuração de cada empresa (Configurações › Horário comercial); feriados
 * ficam para o cadastro de feriados.
 */
export type Jornada = readonly (Expediente | null)[];

const das = (inicioH: number, fimH: number): Expediente => ({ inicio: inicioH * 60, fim: fimH * 60 });
/** O que vale enquanto a empresa não configura a sua: segunda a sexta, das 8h às 18h */
export const JORNADA_PADRAO: Jornada = [null, das(8, 18), das(8, 18), das(8, 18), das(8, 18), das(8, 18), null];

export const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
export const MSG_JORNADA_VAZIA = "Marque ao menos um dia de expediente.";
export const MSG_JORNADA_HORAS = "O fim do expediente precisa ser depois do início.";
export const MSG_JORNADA_DIA_REPETIDO = "Cada dia da semana só pode aparecer uma vez.";

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const emMinutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** 510 → "08:30" */
export const horaDeMinutos = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** A jornada como a tela manda e como fica gravada: só os dias de expediente, cada um com início e fim ("08:00") */
export const horarioComercialSchema = z.object({
  dias: z.array(z.object({
    dia: z.number().int().min(0).max(6),
    inicio: z.string().regex(HORA_RE, "Informe a hora de início (ex.: 08:00)."),
    fim: z.string().regex(HORA_RE, "Informe a hora de fim (ex.: 18:00)."),
  }).strict()).max(7),
}).strict().superRefine((h, ctx) => {
  if (!h.dias.length) ctx.addIssue({ code: "custom", path: ["dias"], message: MSG_JORNADA_VAZIA });
  const vistos = new Set<number>();
  h.dias.forEach((d, i) => {
    if (vistos.has(d.dia)) ctx.addIssue({ code: "custom", path: ["dias", i, "dia"], message: MSG_JORNADA_DIA_REPETIDO });
    vistos.add(d.dia);
    if (HORA_RE.test(d.inicio) && HORA_RE.test(d.fim) && emMinutos(d.fim) <= emMinutos(d.inicio)) ctx.addIssue({ code: "custom", path: ["dias", i, "fim"], message: MSG_JORNADA_HORAS });
  });
});
export type HorarioComercial = z.infer<typeof horarioComercialSchema>;

export function jornadaDe(config: HorarioComercial): Jornada {
  const jornada: (Expediente | null)[] = [null, null, null, null, null, null, null];
  for (const d of config.dias) jornada[d.dia] = { inicio: emMinutos(d.inicio), fim: emMinutos(d.fim) };
  return jornada;
}
export function horarioDe(jornada: Jornada): HorarioComercial {
  return { dias: jornada.flatMap((e, dia) => (e ? [{ dia, inicio: horaDeMinutos(e.inicio), fim: horaDeMinutos(e.fim) }] : [])) };
}
/** Lê o que a empresa gravou; vazio ou fora do formato = a jornada padrão (nunca uma jornada sem expediente). */
export function lerJornada(json: unknown): Jornada {
  const lido = horarioComercialSchema.safeParse(json);
  return lido.success ? jornadaDe(lido.data) : JORNADA_PADRAO;
}

const horaFalada = (m: number) => (m % 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m / 60}h`);
/** "segunda a sexta, das 8h às 18h" · "segunda a sexta, das 8h às 18h; sábado, das 8h às 12h" */
export function rotuloDaJornada(jornada: Jornada): string {
  const ordem = [1, 2, 3, 4, 5, 6, 0]; // a semana começa na segunda
  const grupos: { de: number; ate: number; e: Expediente }[] = [];
  ordem.forEach((dia, i) => {
    const e = jornada[dia];
    if (!e) return;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ordem[i - 1] === ultimo.ate && ultimo.e.inicio === e.inicio && ultimo.e.fim === e.fim) ultimo.ate = dia;
    else grupos.push({ de: dia, ate: dia, e });
  });
  // um dia: "sábado"; dois seguidos: "sábado e domingo"; três ou mais: "segunda a sexta"
  const dias = (g: { de: number; ate: number }) => {
    const n = ordem.indexOf(g.ate) - ordem.indexOf(g.de);
    return n === 0 ? DIAS_DA_SEMANA[g.de] : `${DIAS_DA_SEMANA[g.de]} ${n === 1 ? "e" : "a"} ${DIAS_DA_SEMANA[g.ate]}`;
  };
  return grupos.map((g) => `${dias(g)}, das ${horaFalada(g.e.inicio)} às ${horaFalada(g.e.fim)}`).join("; ");
}

const MIN = 60_000;
const temExpediente = (jornada: Jornada) => jornada.some((e) => !!e && e.fim > e.inicio);

/** O início do próximo expediente a partir de `d` (o próprio `d` se já estiver dentro de um). */
function inicioDoExpediente(d: Date, jornada: Jornada): Date {
  let p = partesBR(d);
  for (let i = 0; i < 8; i++) {
    const e = jornada[p.diaSemana];
    const agora = p.hora * 60 + p.minuto;
    if (e && agora < e.inicio) return instanteBR(p.ano, p.mes, p.dia, Math.floor(e.inicio / 60), e.inicio % 60);
    if (e && agora < e.fim) return d;
    // depois do expediente (ou dia sem expediente): o começo do dia seguinte
    d = instanteBR(p.ano, p.mes, p.dia + 1, 0);
    p = partesBR(d);
  }
  return d;
}

/**
 * `inicio` + `horas`. Corridas: o relógio. Só em horário comercial: conta apenas os minutos dentro
 * do expediente DA EMPRESA (`jornada`) — na jornada padrão, chamado aberto sexta às 17h com prazo de
 * 4 h vence segunda às 11h.
 */
export function somarHoras(inicio: Date, horas: number, soHorarioComercial = false, jornada: Jornada = JORNADA_PADRAO): Date {
  if (!soHorarioComercial) return new Date(inicio.getTime() + horas * 60 * MIN);
  const j = temExpediente(jornada) ? jornada : JORNADA_PADRAO;
  let restante = horas * 60 * MIN;
  let cursor = inicioDoExpediente(inicio, j);
  for (let i = 0; i < 4000; i++) {
    const p = partesBR(cursor);
    const e = j[p.diaSemana]!;
    const fim = instanteBR(p.ano, p.mes, p.dia, Math.floor(e.fim / 60), e.fim % 60);
    const disponivel = fim.getTime() - cursor.getTime();
    if (restante <= disponivel) return new Date(cursor.getTime() + restante);
    restante -= disponivel;
    cursor = inicioDoExpediente(instanteBR(p.ano, p.mes, p.dia + 1, 0), j);
  }
  return cursor;
}

/** Os dois limites de um chamado aberto em `abertoEm`, pela regra da prioridade dele. */
export function limitesDoAtendimento(abertoEm: Date, regra: RegraAtendimento | null, jornada: Jornada = JORNADA_PADRAO): { comparecerAte: Date | null; resolverAte: Date | null } {
  if (!regra) return { comparecerAte: null, resolverAte: null };
  return {
    comparecerAte: regra.comparecerHoras != null ? somarHoras(abertoEm, regra.comparecerHoras, regra.soHorarioComercial, jornada) : null,
    resolverAte: regra.resolverHoras != null ? somarHoras(abertoEm, regra.resolverHoras, regra.soHorarioComercial, jornada) : null,
  };
}

/* ───────── quais OS têm prazo de atendimento ───────── */

/**
 * Só o CHAMADO DE CLIENTE em CONTRATO: a OS precisa estar ligada a um contrato e ter a abertura do
 * chamado registrada (o portal, o QR e a OS marcada como "Chamado do cliente" registram sozinhos, na
 * hora — ninguém digita nem edita). A preventiva recorrente fica de fora — ninguém abriu chamado.
 */
export function temPrazoDeAtendimento(os: { contratoId?: string | null; origem?: string | null; chamadoAbertoEm?: Date | string | null }): boolean {
  return !!os.contratoId && !!os.chamadoAbertoEm && os.origem !== "RECORRENTE";
}

/* ───────── a situação de um prazo, agora ───────── */

/**
 * SEM_REGISTRO: a OS foi encerrada sem que o cumprimento deste prazo ficasse registrado (concluída
 * sem "Cheguei", ou cancelada). O relógio não corre mais — e não se afirma atraso que ninguém mediu.
 */
export const SITUACOES_ATENDIMENTO = ["SEM_PRAZO", "NO_PRAZO", "VENCENDO", "ESTOURADO", "CUMPRIDO", "CUMPRIDO_FORA", "SEM_REGISTRO"] as const;
export type SituacaoAtendimento = (typeof SITUACOES_ATENDIMENTO)[number];

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
    case "SEM_REGISTRO": return "sem registro";
    default: return "sem prazo";
  }
}

const correndo = (p: PrazoAtendimento) => p.situacao === "NO_PRAZO" || p.situacao === "VENCENDO" || p.situacao === "ESTOURADO";

/**
 * Os dois prazos de atendimento de uma OS, lidos do que ficou gravado nela.
 *   • Comparecer se cumpre com a chegada registrada; resolver, com a OS concluída (a data de conclusão
 *     só vale com a OS concluída: reabrir a OS reabre o prazo).
 *   • OS ENCERRADA não tem relógio correndo. Concluída sem chegada registrada: se terminou até o
 *     limite de comparecer, o técnico chegou antes dele (cumprido); se terminou depois, não há como
 *     saber quando chegou — "sem registro". Cancelada: o que estava em aberto fica "sem registro".
 */
export function atendimentoDaOs(os: {
  chamadoAbertoEm?: Date | string | null;
  atendimentoComparecerAte?: Date | string | null; atendimentoResolverAte?: Date | string | null;
  atendimentoComparecidoEm?: Date | string | null; dataConclusao?: Date | string | null; status?: string;
}, agora: Date = new Date()): { comparecer: PrazoAtendimento; resolver: PrazoAtendimento } {
  const concluida = os.status === "CONCLUIDA";
  const conclusao = concluida && os.dataConclusao ? new Date(os.dataConclusao) : null;
  let comparecer = situacaoAtendimento({ limite: os.atendimentoComparecerAte, cumpridoEm: os.atendimentoComparecidoEm, abertoEm: os.chamadoAbertoEm }, agora);
  let resolver = situacaoAtendimento({ limite: os.atendimentoResolverAte, cumpridoEm: conclusao, abertoEm: os.chamadoAbertoEm }, agora);
  if (concluida || os.status === "CANCELADA") {
    const semRegistro = (p: PrazoAtendimento): PrazoAtendimento => ({ situacao: "SEM_REGISTRO", limite: p.limite, cumpridoEm: null, minutos: 0 });
    if (correndo(comparecer)) {
      comparecer = conclusao && conclusao.getTime() <= comparecer.limite!.getTime()
        ? { situacao: "CUMPRIDO", limite: comparecer.limite, cumpridoEm: null, minutos: 0 }
        : semRegistro(comparecer);
    }
    if (correndo(resolver)) resolver = semRegistro(resolver);
  }
  return { comparecer, resolver };
}

/* ───────── o que precisa de atenção agora ───────── */

export type AlertaAtendimento = "ESTOURADO" | "VENCENDO";
export const ALERTAS_ATENDIMENTO = ["vencendo", "estourado"] as const;
export type FiltroAtendimento = (typeof ALERTAS_ATENDIMENTO)[number];
export const ROTULO_FILTRO_ATENDIMENTO: Record<FiltroAtendimento, string> = { vencendo: "Vencendo", estourado: "Estourado" };

/**
 * A OS pede atenção por causa do prazo de atendimento? O pior dos dois prazos ainda em aberto:
 * estourado ganha de vencendo. null = sem prazo, com folga ou já cumprido. OS encerrada (concluída ou
 * cancelada) não alerta: não há mais o que fazer por ela.
 */
export function alertaDoAtendimento(os: Parameters<typeof atendimentoDaOs>[0], agora: Date = new Date()): AlertaAtendimento | null {
  const { comparecer, resolver } = atendimentoDaOs(os, agora);
  const situacoes = [comparecer.situacao, resolver.situacao];
  return situacoes.includes("ESTOURADO") ? "ESTOURADO" : situacoes.includes("VENCENDO") ? "VENCENDO" : null;
}

/* ───────── da proposta para o contrato ───────── */

/** As prioridades que a proposta chama de "emergencial" e as que chama de "normal" */
export const PRIORIDADES_EMERGENCIAIS: readonly PrioridadeOs[] = ["ALTA", "URGENTE", "CRITICO"];
export const PRIORIDADES_NORMAIS: readonly PrioridadeOs[] = ["BAIXA", "NORMAL"];

/**
 * A proposta de contrato promete duas coisas — "atendimento emergencial em X horas" e "atendimento
 * normal em Y horas". Ao virar contrato, cada uma vira o prazo de COMPARECER das prioridades do seu
 * grupo, em horas corridas (o horário de atendimento da proposta é texto livre: quem quiser contar só
 * o expediente marca no contrato). Sem hora informada (ou zero), o grupo fica sem prazo.
 */
export function regrasDaProposta(p: { prazoEmergencial?: number | null; prazoNormal?: number | null }): RegraAtendimento[] {
  const horasDe = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.min(Math.floor(v), HORAS_MAX) : null);
  const emergencial = horasDe(p.prazoEmergencial);
  const normal = horasDe(p.prazoNormal);
  return PRIORIDADES.flatMap((prioridade) => {
    const comparecerHoras = PRIORIDADES_EMERGENCIAIS.includes(prioridade) ? emergencial : normal;
    return comparecerHoras === null ? [] : [{ prioridade, comparecerHoras, resolverHoras: null, soHorarioComercial: false }];
  });
}
