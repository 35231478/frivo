/**
 * Prazos da OS — PR 4 (prazo de atendimento do contrato), as regras puras:
 *  - o HORÁRIO COMERCIAL é da empresa (a jornada semanal de Configurações), não um número escrito no
 *    código: a mesma promessa vence em horas diferentes conforme o expediente de cada empresa;
 *  - a jornada como a tela manda (validação), como fica gravada e como se diz por extenso;
 *  - a abertura do chamado digitada na OS lançada à mão;
 *  - o que pede atenção (vencendo, estourado) — a régua do sino, do selo e do filtro da lista;
 *  - da proposta para o contrato; do contrato para o formulário e de volta;
 *  - a TRAVA: os limites e o comparecimento só são gravados por lib/atendimento/prazo-server.ts, e
 *    ninguém faz a conta do prazo de atendimento por fora de lib/atendimento.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  ALERTAS_ATENDIMENTO, HORAS_MAX, JORNADA_PADRAO, MSG_JORNADA_DIA_REPETIDO, MSG_JORNADA_HORAS,
  MSG_JORNADA_VAZIA, PRIORIDADES, ROTULO_FILTRO_ATENDIMENTO, alertaDoAtendimento, atendimentoDaOs, horaDeMinutos, horarioComercialSchema, horarioDe, jornadaDe,
  lerJornada, limitesDoAtendimento, regrasAtendimentoSchema, regrasDaProposta, rotuloDaJornada, somarHoras, textoAtendimento,
  type HorarioComercial,
} from "@/lib/atendimento/prazo";
import { PRAZOS_EM_BRANCO, abrirPorPrioridade, prazosDoFormulario, prazosParaOFormulario, voltarAoPrazoUnico } from "@/lib/atendimento/formulario";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** Um instante dito no relógio de Brasília (UTC−3) */
const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);
const semana = (inicio: string, fim: string, dias = [1, 2, 3, 4, 5]) => dias.map((dia) => ({ dia, inicio, fim }));

/** Empresa que abre sábado de manhã */
const COM_SABADO: HorarioComercial = { dias: [...semana("08:00", "18:00"), { dia: 6, inicio: "08:00", fim: "12:00" }] };
/** Empresa que entra cedo e sai cedo */
const CEDO: HorarioComercial = { dias: semana("07:30", "17:00") };
// 18/11/2026 é quarta; 20 é sexta; 21, sábado; 22, domingo; 23, segunda

/* ═════════ o horário comercial é de cada empresa ═════════ */
describe("Horário comercial por empresa — a mesma promessa, o expediente de cada uma", () => {
  it("chamado de sexta às 17h com 4 h: na jornada padrão vence segunda às 11h; na empresa que abre sábado, sábado às 11h", () => {
    const aberto = br("2026-11-20", "17:00");
    expect(iso(somarHoras(aberto, 4, true))).toBe(iso(br("2026-11-23", "11:00")));
    expect(iso(somarHoras(aberto, 4, true, JORNADA_PADRAO))).toBe(iso(br("2026-11-23", "11:00")));
    expect(iso(somarHoras(aberto, 4, true, jornadaDe(COM_SABADO)))).toBe(iso(br("2026-11-21", "11:00")));
  });

  it("o sábado tem o SEU expediente: 3 h abertas sábado às 11h usam 1 h do sábado e 2 h da segunda", () => {
    expect(iso(somarHoras(br("2026-11-21", "11:00"), 3, true, jornadaDe(COM_SABADO)))).toBe(iso(br("2026-11-23", "10:00")));
    // e chamado de sábado à tarde (fora do expediente do sábado) começa a contar na segunda às 8h
    expect(iso(somarHoras(br("2026-11-21", "15:00"), 2, true, jornadaDe(COM_SABADO)))).toBe(iso(br("2026-11-23", "10:00")));
  });

  it("início e fim com minutos: expediente das 7h30 às 17h", () => {
    const j = jornadaDe(CEDO);
    // quarta 16h30 + 2 h: meia hora na quarta, 1h30 na quinta a partir das 7h30
    expect(iso(somarHoras(br("2026-11-18", "16:30"), 2, true, j))).toBe(iso(br("2026-11-19", "09:00")));
    // às 17h15 esta empresa já fechou (conta 1 h a partir das 7h30); na jornada padrão ainda restavam 45 min do dia
    expect(iso(somarHoras(br("2026-11-18", "17:15"), 1, true, j))).toBe(iso(br("2026-11-19", "08:30")));
    expect(iso(somarHoras(br("2026-11-18", "17:15"), 1, true))).toBe(iso(br("2026-11-19", "08:15")));
    // antes de abrir: conta das 7h30
    expect(iso(somarHoras(br("2026-11-18", "06:00"), 1, true, j))).toBe(iso(br("2026-11-18", "08:30")));
  });

  it("empresa que só atende um dia por semana: o prazo atravessa as semanas", () => {
    const soDomingo = jornadaDe({ dias: [{ dia: 0, inicio: "09:00", fim: "13:00" }] });
    // quarta + 5 h: 4 h no domingo 22 e 1 h no domingo 29
    expect(iso(somarHoras(br("2026-11-18", "10:00"), 5, true, soDomingo))).toBe(iso(br("2026-11-29", "10:00")));
  });

  it("horas corridas não olham a jornada de ninguém", () => {
    const aberto = br("2026-11-20", "17:00");
    expect(iso(somarHoras(aberto, 4, false, jornadaDe(COM_SABADO)))).toBe(iso(br("2026-11-20", "21:00")));
    expect(iso(somarHoras(aberto, 4))).toBe(iso(br("2026-11-20", "21:00")));
  });

  it("os dois limites do chamado usam a jornada da empresa quando a regra conta só o expediente", () => {
    const regra = { prioridade: "NORMAL", comparecerHoras: 4, resolverHoras: 12, soHorarioComercial: true };
    const aberto = br("2026-11-20", "17:00");
    const padrao = limitesDoAtendimento(aberto, regra);
    expect([iso(padrao.comparecerAte), iso(padrao.resolverAte)]).toEqual([iso(br("2026-11-23", "11:00")), iso(br("2026-11-24", "09:00"))]);
    const comSabado = limitesDoAtendimento(aberto, regra, jornadaDe(COM_SABADO));
    // 1 h na sexta + 4 h no sábado + 7 h na segunda
    expect([iso(comSabado.comparecerAte), iso(comSabado.resolverAte)]).toEqual([iso(br("2026-11-21", "11:00")), iso(br("2026-11-23", "15:00"))]);
    // a regra em horas corridas ignora a jornada
    const corrida = limitesDoAtendimento(aberto, { ...regra, soHorarioComercial: false }, jornadaDe(COM_SABADO));
    expect([iso(corrida.comparecerAte), iso(corrida.resolverAte)]).toEqual([iso(br("2026-11-20", "21:00")), iso(br("2026-11-21", "05:00"))]);
  });

  it("jornada sem nenhum expediente nunca trava a conta: vale a padrão", () => {
    const vazia = [null, null, null, null, null, null, null];
    expect(iso(somarHoras(br("2026-11-20", "17:00"), 4, true, vazia))).toBe(iso(br("2026-11-23", "11:00")));
  });
});

describe("Horário comercial — o que a tela manda, o que fica gravado e como se diz", () => {
  it("a jornada vai e volta sem perder nada (só os dias com expediente ficam gravados)", () => {
    expect(horarioDe(jornadaDe(COM_SABADO))).toEqual({ dias: [...semana("08:00", "18:00"), { dia: 6, inicio: "08:00", fim: "12:00" }] });
    expect(horarioDe(JORNADA_PADRAO)).toEqual({ dias: semana("08:00", "18:00") });
    expect(jornadaDe(CEDO)[1]).toEqual({ inicio: 450, fim: 1020 });
    expect(jornadaDe(CEDO)[0]).toBeNull();
    expect(jornadaDe(CEDO)[6]).toBeNull();
    expect(horaDeMinutos(450)).toBe("07:30");
    expect(horaDeMinutos(0)).toBe("00:00");
  });

  it("sem configuração (ou com lixo gravado), vale segunda a sexta, das 8h às 18h — o que valia antes", () => {
    expect(lerJornada(null)).toBe(JORNADA_PADRAO);
    expect(lerJornada(undefined)).toBe(JORNADA_PADRAO);
    expect(lerJornada({ dias: [] })).toBe(JORNADA_PADRAO);
    expect(lerJornada({ dias: [{ dia: 9, inicio: "08:00", fim: "18:00" }] })).toBe(JORNADA_PADRAO);
    expect(lerJornada("08:00-18:00")).toBe(JORNADA_PADRAO);
    expect(lerJornada(COM_SABADO)).toEqual(jornadaDe(COM_SABADO));
    expect(JORNADA_PADRAO).toEqual([null, { inicio: 480, fim: 1080 }, { inicio: 480, fim: 1080 }, { inicio: 480, fim: 1080 }, { inicio: 480, fim: 1080 }, { inicio: 480, fim: 1080 }, null]);
  });

  it("validação: ao menos um dia; cada dia uma vez; o fim depois do início; hora no formato HH:mm; nada além do combinado", () => {
    const erro = (v: unknown) => { const r = horarioComercialSchema.safeParse(v); return r.success ? null : r.error.issues[0]?.message; };
    expect(erro(COM_SABADO)).toBeNull();
    expect(erro({ dias: [] })).toBe(MSG_JORNADA_VAZIA);
    expect(erro({ dias: [{ dia: 1, inicio: "08:00", fim: "18:00" }, { dia: 1, inicio: "09:00", fim: "12:00" }] })).toBe(MSG_JORNADA_DIA_REPETIDO);
    expect(erro({ dias: [{ dia: 1, inicio: "18:00", fim: "08:00" }] })).toBe(MSG_JORNADA_HORAS);
    expect(erro({ dias: [{ dia: 1, inicio: "08:00", fim: "08:00" }] })).toBe(MSG_JORNADA_HORAS);
    expect(erro({ dias: [{ dia: 1, inicio: "8h", fim: "18:00" }] })).toBe("Informe a hora de início (ex.: 08:00).");
    expect(erro({ dias: [{ dia: 1, inicio: "08:00", fim: "24:00" }] })).toBe("Informe a hora de fim (ex.: 18:00).");
    expect(erro({ dias: [{ dia: 7, inicio: "08:00", fim: "18:00" }] })).not.toBeNull();
    expect(erro({ dias: [{ dia: 1.5, inicio: "08:00", fim: "18:00" }] })).not.toBeNull();
    expect(erro({ dias: [{ dia: 1, inicio: "08:00", fim: "18:00", feriado: true }] })).not.toBeNull();
    expect(erro({ dias: semana("08:00", "18:00"), empresaId: "e2" })).not.toBeNull();
    expect(erro(null)).not.toBeNull();
  });

  it("por extenso: dias seguidos com o mesmo expediente viram um intervalo; o resto vem separado", () => {
    expect(rotuloDaJornada(JORNADA_PADRAO)).toBe("segunda a sexta, das 8h às 18h");
    expect(rotuloDaJornada(jornadaDe(COM_SABADO))).toBe("segunda a sexta, das 8h às 18h; sábado, das 8h às 12h");
    expect(rotuloDaJornada(jornadaDe(CEDO))).toBe("segunda a sexta, das 7h30 às 17h");
    expect(rotuloDaJornada(jornadaDe({ dias: semana("08:00", "18:00", [1, 3]) }))).toBe("segunda, das 8h às 18h; quarta, das 8h às 18h");
    expect(rotuloDaJornada(jornadaDe({ dias: semana("09:00", "13:00", [6, 0]) }))).toBe("sábado e domingo, das 9h às 13h");
    expect(rotuloDaJornada(jornadaDe({ dias: semana("08:00", "18:00", [1, 2]) }))).toBe("segunda e terça, das 8h às 18h");
    // a semana começa na segunda: o domingo vem por último, e a semana inteira é um intervalo só
    expect(rotuloDaJornada(jornadaDe({ dias: semana("06:00", "22:00", [0, 1, 2, 3, 4, 5, 6]) }))).toBe("segunda a domingo, das 6h às 22h");
    expect(rotuloDaJornada(jornadaDe({ dias: [{ dia: 0, inicio: "08:00", fim: "12:00" }, ...semana("08:00", "18:00")] }))).toBe("segunda a sexta, das 8h às 18h; domingo, das 8h às 12h");
  });
});

/* ═════════ o que pede atenção ═════════ */
describe("Prazo de atendimento — o que pede atenção agora (sino, selo da OS e filtro da lista)", () => {
  // chamado das 10h: comparecer até 14h (4 h), resolver até as 10h do dia seguinte (24 h)
  const os = (extra: Record<string, unknown> = {}) => ({
    status: "AGENDADA", chamadoAbertoEm: br("2026-11-18", "10:00"),
    atendimentoComparecerAte: br("2026-11-18", "14:00"), atendimentoResolverAte: br("2026-11-19", "10:00"), ...extra,
  });

  it("com folga não alerta; perto do limite, VENCENDO; passou do limite, ESTOURADO", () => {
    expect(alertaDoAtendimento(os(), br("2026-11-18", "12:00"))).toBeNull();
    expect(alertaDoAtendimento(os(), br("2026-11-18", "12:59"))).toBeNull(); // falta 1h01: ainda não
    expect(alertaDoAtendimento(os(), br("2026-11-18", "13:00"))).toBe("VENCENDO"); // falta 1 h (o aviso mínimo)
    expect(alertaDoAtendimento(os(), br("2026-11-18", "14:00"))).toBe("VENCENDO"); // no minuto do limite ainda não estourou
    expect(alertaDoAtendimento(os(), br("2026-11-18", "14:01"))).toBe("ESTOURADO");
  });

  it("o técnico chegou: o comparecimento sai da conta e fica só o prazo de resolver", () => {
    const chegou = os({ atendimentoComparecidoEm: br("2026-11-18", "13:30") });
    expect(alertaDoAtendimento(chegou, br("2026-11-18", "14:30"))).toBeNull();
    // resolver: 24 h de prazo → avisa nas últimas 4h48
    expect(alertaDoAtendimento(chegou, br("2026-11-19", "05:11"))).toBeNull();
    expect(alertaDoAtendimento(chegou, br("2026-11-19", "05:12"))).toBe("VENCENDO");
    expect(alertaDoAtendimento(chegou, br("2026-11-19", "10:01"))).toBe("ESTOURADO");
    // chegou atrasado: o comparecimento ficou "cumprido com atraso", mas não é mais um alerta em aberto
    expect(alertaDoAtendimento(os({ atendimentoComparecidoEm: br("2026-11-18", "16:00") }), br("2026-11-18", "16:30"))).toBeNull();
  });

  it("vale o pior dos dois: um estourado ganha de um vencendo", () => {
    const soResolverCurto = os({ atendimentoComparecerAte: br("2026-11-18", "14:00"), atendimentoResolverAte: br("2026-11-18", "13:30") });
    expect(alertaDoAtendimento(soResolverCurto, br("2026-11-18", "13:40"))).toBe("ESTOURADO");
  });

  it("OS concluída não alerta mais; cancelada nunca alerta; sem limite gravado não há o que alertar", () => {
    const depois = br("2026-11-20", "10:00");
    expect(alertaDoAtendimento(os({ atendimentoComparecidoEm: br("2026-11-18", "13:00") }), depois)).toBe("ESTOURADO");
    expect(alertaDoAtendimento(os({ atendimentoComparecidoEm: br("2026-11-18", "13:00"), status: "CONCLUIDA", dataConclusao: br("2026-11-19", "09:00") }), depois)).toBeNull();
    expect(alertaDoAtendimento(os({ status: "CANCELADA" }), depois)).toBeNull();
    expect(alertaDoAtendimento({ status: "ABERTA", chamadoAbertoEm: br("2026-11-18", "10:00") }, depois)).toBeNull();
    // reaberta depois de concluída: o prazo de resolver volta a contar
    expect(alertaDoAtendimento(os({ atendimentoComparecidoEm: br("2026-11-18", "13:00"), status: "EM_ANDAMENTO", dataConclusao: br("2026-11-19", "09:00") }), depois)).toBe("ESTOURADO");
  });

  it("OS encerrada não tem relógio correndo: concluída sem \"Cheguei\" não vira um \"estourado\" que cresce para sempre", () => {
    const semanasDepois = br("2026-12-20", "10:00");
    const ler = (extra: Record<string, unknown>) => { const a = atendimentoDaOs(os(extra), semanasDepois); return [a.comparecer.situacao, a.resolver.situacao]; };
    // aberta e esquecida: aí sim, estourado
    expect(ler({})).toEqual(["ESTOURADO", "ESTOURADO"]);
    // concluída pelo escritório, sem ninguém tocar em "Cheguei": terminou ANTES do limite de comparecer → chegou antes dele
    const cedo = atendimentoDaOs(os({ status: "CONCLUIDA", dataConclusao: br("2026-11-18", "13:00") }), semanasDepois);
    expect([cedo.comparecer.situacao, cedo.comparecer.cumpridoEm, cedo.resolver.situacao]).toEqual(["CUMPRIDO", null, "CUMPRIDO"]);
    expect(ler({ status: "CONCLUIDA", dataConclusao: br("2026-11-18", "14:00") })).toEqual(["CUMPRIDO", "CUMPRIDO"]); // no minuto do limite
    // terminou depois do limite de comparecer: não há como saber quando chegou — não se afirma atraso
    expect(ler({ status: "CONCLUIDA", dataConclusao: br("2026-11-18", "17:00") })).toEqual(["SEM_REGISTRO", "CUMPRIDO"]);
    expect(ler({ status: "CONCLUIDA", dataConclusao: br("2026-11-20", "17:00") })).toEqual(["SEM_REGISTRO", "CUMPRIDO_FORA"]);
    // a chegada registrada continua valendo como foi: no prazo ou com atraso
    expect(ler({ status: "CONCLUIDA", dataConclusao: br("2026-11-18", "17:00"), atendimentoComparecidoEm: br("2026-11-18", "15:00") })).toEqual(["CUMPRIDO_FORA", "CUMPRIDO"]);
    // concluída sem data de conclusão (registro antigo) e cancelada: o que estava em aberto fica sem registro
    expect(ler({ status: "CONCLUIDA", dataConclusao: null })).toEqual(["SEM_REGISTRO", "SEM_REGISTRO"]);
    expect(ler({ status: "CANCELADA" })).toEqual(["SEM_REGISTRO", "SEM_REGISTRO"]);
    expect(ler({ status: "CANCELADA", atendimentoComparecidoEm: br("2026-11-18", "13:00") })).toEqual(["CUMPRIDO", "SEM_REGISTRO"]);
    // o texto não fala em atraso, e a situação guarda o limite que tinha sido prometido
    const sem = atendimentoDaOs(os({ status: "CANCELADA" }), semanasDepois).comparecer;
    expect([textoAtendimento(sem), iso(sem.limite), sem.minutos]).toEqual(["sem registro", iso(br("2026-11-18", "14:00")), 0]);
    // reaberta: o relógio volta
    expect(ler({ status: "EM_ANDAMENTO", dataConclusao: br("2026-11-18", "13:00") })).toEqual(["ESTOURADO", "ESTOURADO"]);
    // e nenhuma OS encerrada alerta
    for (const status of ["CONCLUIDA", "CANCELADA"]) expect(alertaDoAtendimento(os({ status }), semanasDepois), status).toBeNull();
  });

  it("os filtros da lista têm os nomes que o sino usa", () => {
    expect([...ALERTAS_ATENDIMENTO]).toEqual(["vencendo", "estourado"]);
    expect(ROTULO_FILTRO_ATENDIMENTO).toEqual({ vencendo: "Vencendo", estourado: "Estourado" });
  });
});

/* ═════════ da proposta para o contrato ═════════ */
describe("Proposta de contrato → prazo de atendimento do contrato", () => {
  it("o \"emergencial\" vira o comparecimento de Alta, Urgente e Crítica; o \"normal\", de Baixa e Normal — em horas corridas", () => {
    expect(regrasDaProposta({ prazoEmergencial: 4, prazoNormal: 24 })).toEqual([
      { prioridade: "BAIXA", comparecerHoras: 24, resolverHoras: null, soHorarioComercial: false },
      { prioridade: "NORMAL", comparecerHoras: 24, resolverHoras: null, soHorarioComercial: false },
      { prioridade: "ALTA", comparecerHoras: 4, resolverHoras: null, soHorarioComercial: false },
      { prioridade: "URGENTE", comparecerHoras: 4, resolverHoras: null, soHorarioComercial: false },
      { prioridade: "CRITICO", comparecerHoras: 4, resolverHoras: null, soHorarioComercial: false },
    ]);
  });

  it("o que a proposta não prometeu não vira prazo; o resultado sempre passa na validação do contrato", () => {
    expect(regrasDaProposta({ prazoEmergencial: 4 }).map((r) => r.prioridade)).toEqual(["ALTA", "URGENTE", "CRITICO"]);
    expect(regrasDaProposta({ prazoNormal: 48, prazoEmergencial: null }).map((r) => r.prioridade)).toEqual(["BAIXA", "NORMAL"]);
    expect(regrasDaProposta({})).toEqual([]);
    expect(regrasDaProposta({ prazoEmergencial: 0, prazoNormal: null })).toEqual([]);
    expect(regrasDaProposta({ prazoEmergencial: 0.5, prazoNormal: -3 })).toEqual([]);
    expect(regrasDaProposta({ prazoEmergencial: Number.NaN, prazoNormal: Number.POSITIVE_INFINITY })).toEqual([]);
    // horas quebradas viram horas inteiras; um número absurdo fica no teto do contrato
    expect(regrasDaProposta({ prazoEmergencial: 2.7, prazoNormal: 999_999 }).map((r) => r.comparecerHoras)).toEqual([HORAS_MAX, HORAS_MAX, 2, 2, 2]);
    for (const p of [{ prazoEmergencial: 4, prazoNormal: 24 }, { prazoEmergencial: 2.7, prazoNormal: 999_999 }, { prazoEmergencial: 1 }, {}])
      expect(regrasAtendimentoSchema.safeParse(regrasDaProposta(p)).success, JSON.stringify(p)).toBe(true);
  });
});

/* ═════════ o formulário do contrato ═════════ */
describe("Contrato — do que está gravado para a tela, e de volta", () => {
  const linha = (prioridade: string, comparecerHoras: number | null, resolverHoras: number | null, soHorarioComercial = false) => ({ prioridade, comparecerHoras, resolverHoras, soHorarioComercial });
  const todas = (c: number | null, r: number | null, so = false) => PRIORIDADES.map((p) => linha(p, c, r, so));

  it("contrato sem prazo abre em branco, no modo simples", () => {
    for (const v of [null, undefined, []]) expect(prazosParaOFormulario(v)).toEqual(PRAZOS_EM_BRANCO());
    expect(PRAZOS_EM_BRANCO()).toMatchObject({ porPrioridade: false, geral: { comparecer: "", resolver: "" }, soHorarioComercial: false });
    expect(prazosDoFormulario(PRAZOS_EM_BRANCO())).toEqual([]);
  });

  it("as cinco prioridades iguais abrem no modo simples: UM prazo para todo chamado", () => {
    const f = prazosParaOFormulario(todas(4, 24, true));
    expect(f).toMatchObject({ porPrioridade: false, geral: { comparecer: "4", resolver: "24" }, soHorarioComercial: true });
    expect(prazosDoFormulario(f)).toEqual(todas(4, 24, true));
  });

  it("qualquer diferença abre \"por prioridade\" — nada fica escondido atrás do modo simples", () => {
    const gravado = [linha("NORMAL", 24, 72), linha("URGENTE", 4, 24), linha("CRITICO", 2, null)];
    const f = prazosParaOFormulario(gravado);
    expect(f.porPrioridade).toBe(true);
    expect(f.linhas).toEqual({
      BAIXA: { comparecer: "", resolver: "" }, NORMAL: { comparecer: "24", resolver: "72" }, ALTA: { comparecer: "", resolver: "" },
      URGENTE: { comparecer: "4", resolver: "24" }, CRITICO: { comparecer: "2", resolver: "" },
    });
    // de volta: só as prioridades que prometem alguma coisa
    expect(prazosDoFormulario(f)).toEqual(gravado);
    // só uma prioridade configurada (as outras em branco) também é "diferente"
    expect(prazosParaOFormulario([linha("URGENTE", 4, null)]).porPrioridade).toBe(true);
    // o que veio da proposta (emergencial × normal) abre por prioridade
    expect(prazosParaOFormulario(regrasDaProposta({ prazoEmergencial: 4, prazoNormal: 24 })).porPrioridade).toBe(true);
    // prioridade desconhecida gravada não derruba a tela
    expect(prazosParaOFormulario([linha("EMERGENCIAL", 1, 2), ...todas(4, 24)]).porPrioridade).toBe(false);
  });

  it("o marcador \"só em horário comercial\" vale para o contrato inteiro na tela", () => {
    expect(prazosParaOFormulario([linha("NORMAL", 24, null, true), linha("URGENTE", 4, null, false)]).soHorarioComercial).toBe(true);
    expect(prazosParaOFormulario(todas(4, 24, false)).soHorarioComercial).toBe(false);
    const f = { ...prazosParaOFormulario([linha("NORMAL", 24, null), linha("URGENTE", 4, null)]), soHorarioComercial: true };
    expect(prazosDoFormulario(f).map((r) => r.soHorarioComercial)).toEqual([true, true]);
  });

  it("da tela para o servidor: em branco não entra; só comparecer ou só resolver entra; texto que não é número segue para a validação recusar", () => {
    const f = { ...PRAZOS_EM_BRANCO(), geral: { comparecer: " 4 ", resolver: "" } };
    expect(prazosDoFormulario(f)).toEqual(todas(4, null));
    expect(prazosDoFormulario({ ...PRAZOS_EM_BRANCO(), geral: { comparecer: "", resolver: "48" } })).toEqual(todas(null, 48));
    const torto = prazosDoFormulario({ ...PRAZOS_EM_BRANCO(), geral: { comparecer: "4,5", resolver: "abc" } });
    expect(torto[0]).toMatchObject({ comparecerHoras: "4,5", resolverHoras: "abc" });
    expect(regrasAtendimentoSchema.safeParse(torto).success).toBe(false);
    // o que a tela monta passa na mesma validação que o servidor usa
    expect(regrasAtendimentoSchema.safeParse(prazosDoFormulario(f)).success).toBe(true);
    // e o erro de negócio também é o do servidor: resolver antes de comparecer
    expect(regrasAtendimentoSchema.safeParse(prazosDoFormulario({ ...PRAZOS_EM_BRANCO(), geral: { comparecer: "8", resolver: "4" } })).success).toBe(false);
  });

  it("abrir \"por prioridade\" leva o prazo único para as cinco linhas; voltar fica com o da prioridade Normal", () => {
    const simples = { ...PRAZOS_EM_BRANCO(), geral: { comparecer: "4", resolver: "24" }, soHorarioComercial: true };
    const aberto = abrirPorPrioridade(simples);
    expect(aberto.porPrioridade).toBe(true);
    expect(aberto.soHorarioComercial).toBe(true);
    for (const p of PRIORIDADES) expect(aberto.linhas[p]).toEqual({ comparecer: "4", resolver: "24" });
    expect(prazosDoFormulario(aberto)).toEqual(prazosDoFormulario(simples)); // a troca de modo não muda o que se grava
    expect(abrirPorPrioridade(aberto)).toBe(aberto);

    const mexido = { ...aberto, linhas: { ...aberto.linhas, NORMAL: { comparecer: "12", resolver: "48" }, CRITICO: { comparecer: "1", resolver: "4" } } };
    const devolta = voltarAoPrazoUnico(mexido);
    expect(devolta).toMatchObject({ porPrioridade: false, geral: { comparecer: "12", resolver: "48" } });
    expect(prazosDoFormulario(devolta)).toEqual(todas(12, 48, true));
    expect(voltarAoPrazoUnico(simples)).toBe(simples);
  });
});

/* ═════════ a trava: a conta do prazo de atendimento mora num lugar só ═════════ */
describe("Prazo de atendimento — ninguém calcula nem grava por fora da regra única", () => {
  const RAIZ = path.resolve(__dirname, "../..");
  const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
  const arquivos = (dir: string): string[] => readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? arquivos(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
  const TODOS = ["app", "lib", "components"].flatMap(arquivos);
  const comTexto = (re: RegExp, fora: string[] = []) => TODOS.filter((f) => !fora.includes(f) && re.test(fonte(f))).sort();
  const MOTOR = "lib/atendimento/prazo.ts", SERVIDOR = "lib/atendimento/prazo-server.ts";

  it("os limites e o comparecimento gravados na OS só são lidos e escritos dentro de lib/atendimento", () => {
    // Telas, rotas, sino e lista passam a OS inteira para atendimentoDaOs / alertaDoAtendimento; nenhuma
    // compara "comparecer até" com a hora de agora por conta própria, e nenhuma rota grava os campos
    // o relatório de cumprimento de prazos (PR 5) LÊ as colunas para relatar — e só lê
    const RELATORIO = ["lib/prazos/cumprimento.ts", "lib/prazos/cumprimento-server.ts"];
    // a rota do atraso justificado também LÊ as colunas (desde a pausa de SLA, o gatilho olha os TRÊS prazos,
    // não só a execução) — mas só as lê: ela grava a justificativa, e nenhuma delas entra no que ela grava
    const GATILHO = "app/api/ordens/[id]/atraso-justificado/route.ts";
    expect(comTexto(/atendimentoComparecerAte|atendimentoResolverAte|atendimentoComparecidoEm/)).toEqual([SERVIDOR, MOTOR, GATILHO, ...RELATORIO].sort());
    for (const f of RELATORIO) expect(fonte(f), f).not.toMatch(/ordemServico\.(create|createMany|update|updateMany|upsert)\(|data:\s*\{/);
    for (const uso of fonte(GATILHO).match(/atendimento(?:ComparecerAte|ResolverAte|ComparecidoEm):[^,\n]*/g) ?? [])
      expect(uso, GATILHO).toMatch(/:\s*true$/); // só dentro do select
    expect(comTexto(/atendimento_comparecer_ate|atendimento_resolver_ate|atendimento_comparecido_em/)).toEqual([]); // nem por SQL cru
    const servidor = fonte(SERVIDOR);
    // um ponto de escrita para os limites e um para o comparecimento
    expect(servidor.match(/data:\s*\{\s*atendimentoComparecerAte:/g)).toHaveLength(1);
    expect(servidor.match(/data:\s*\{\s*atendimentoComparecidoEm:/g)).toHaveLength(1);
    // o comparecimento só entra onde ainda não há um (o primeiro "Cheguei" é o que vale)
    expect(servidor).toMatch(/where:\s*\{\s*id:\s*osId,\s*atendimentoComparecidoEm:\s*null\s*\}/);
  });

  it("somar horas a uma abertura de chamado é só no motor; fixar os limites, só nos momentos combinados", () => {
    expect(comTexto(/\bsomarHoras\(|\blimitesDoAtendimento\(/)).toEqual([SERVIDOR, MOTOR]);
    // contrato e prioridade definidos: o aceite do chamado, a OS lançada como chamado e a edição da própria OS
    expect(comTexto(/\bfixarLimitesDaOs\(/, [SERVIDOR])).toEqual(["app/api/ordens/[id]/route.ts", "app/api/ordens/route.ts", "app/api/solicitacoes/[id]/aceitar/route.ts"]);
    // salvar o contrato (ou gerar um da proposta) troca as promessas — e nunca chama o que mexe em OS
    const salvam = ["app/api/contratos/[id]/route.ts", "app/api/contratos/route.ts", "app/api/orcamentos/[id]/gerar-contrato/route.ts"];
    expect(comTexto(/\bsalvarRegrasDoContrato\(/, [SERVIDOR])).toEqual(salvam);
    for (const f of [...salvam, "app/api/configuracoes/horario-comercial/route.ts"]) expect(fonte(f), f).not.toMatch(/fixarLimitesDaOs|ordemServico\.(update|updateMany)\(/);
  });

  it("o comparecimento vem do fluxo que já existia no app: o \"Cheguei\" (e, de reserva, o início da atividade)", () => {
    expect(comTexto(/\bmarcarComparecimento\(/, [SERVIDOR])).toEqual(["lib/execucao/acoes.ts", "lib/execucao/aviso-cliente.ts"]);
    expect(fonte("lib/execucao/aviso-cliente.ts")).toMatch(/d\.evento === "CHEGOU"\)\s*await marcarComparecimento\(/);
  });

  it("a hora de abertura do chamado é sempre a do SERVIDOR, no momento em que o chamado nasce — ninguém digita nem edita", () => {
    // (ler a coluna — select, ordenar, filtrar, tipo — não é gravar: só conta quem escreve OS)
    const escreveOs = (f: string) => /ordemServico\.(create|createMany|update|updateMany|upsert)\(/.test(fonte(f));
    const gravam = TODOS.filter((f) => escreveOs(f) && /chamadoAbertoEm\s*[:=](?!=)/.test(fonte(f).replace(/chamadoAbertoEm\??:\s*(true|Date|z\.|"asc")/g, ""))).sort();
    // quem recebe o chamado: o portal, o QR e a Nova OS marcada como "Chamado do cliente"
    expect(gravam).toEqual(["app/api/ordens/route.ts", "app/api/portal/chamados/route.ts", "app/api/qr/[token]/chamado/route.ts"]);
    // em todos, o valor é o relógio do servidor (new Date()), nunca um campo do corpo da requisição
    for (const f of gravam) {
      const linhas = fonte(f).split("\n").filter((l) => /chamadoAbertoEm\s*[:=](?!=)/.test(l));
      expect(linhas.length, f).toBeGreaterThan(0);
      for (const l of linhas) expect(l, f).toMatch(/new Date\(\)/);
    }
    expect(comTexto(/(body|parsed\.data|d)\.chamadoAbertoEm/)).toEqual([]);
    // editar a OS não toca na abertura; e a tela mostra o campo travado, sem mandar hora nenhuma
    expect(fonte("app/api/ordens/[id]/route.ts")).not.toMatch(/chamadoAbertoEm/);
    const nova = fonte("app/(dashboard)/ordens/nova/page.tsx");
    expect(nova).not.toMatch(/chamadoAbertoEm/);
    expect(nova).toMatch(/aria-label="Chamado aberto em"[^>]*\bdisabled\b/);
    expect(nova).toMatch(/chamadoDoCliente: true/);
    expect(comTexto(/lerAberturaDoChamado|MSG_ABERTURA_/)).toEqual([]);
  });

  it("as horas que o contrato promete só passam por lib/atendimento (e pela página que as entrega ao formulário)", () => {
    expect(comTexto(/comparecerHoras|resolverHoras/)).toEqual(["app/(dashboard)/contratos/[id]/editar/page.tsx", "lib/atendimento/formulario.ts", SERVIDOR, MOTOR]);
    // a página só LÊ as linhas do contrato; a conta não está nela
    expect(fonte("app/(dashboard)/contratos/[id]/editar/page.tsx")).not.toMatch(/getTime\(|somarHoras|\* 60/);
  });

  it("o horário comercial não está mais escrito no código: quem conta lê a jornada da empresa", () => {
    // a configuração gravada só é lida por jornadaDaEmpresa e só é escrita pela rota de Configurações
    expect(comTexto(/horarioComercial:\s*(true|horario)\b/)).toEqual(["app/api/configuracoes/horario-comercial/route.ts", SERVIDOR]);
    expect(fonte(SERVIDOR)).toMatch(/regra\?\.soHorarioComercial \? await jornadaDaEmpresa\(db, os\.empresaId\)/);
    // "das 8h às 18h" por extenso em tela nenhuma: o texto sai de rotuloDaJornada
    // (a admissão fala da jornada do COLABORADOR num exemplo de contrato de trabalho: outro assunto)
    expect(comTexto(/das 8h às 18h|8h–18h|08:00 às 18:00/, [MOTOR, SERVIDOR, "lib/admissao/admissao.ts"])).toEqual([]);
    expect(comTexto(/\bHORARIO_COMERCIAL\b|ROTULO_HORARIO_COMERCIAL/)).toEqual([]);
    // o padrão (seg–sex 8h–18h) existe num lugar só, como o que vale ENQUANTO a empresa não configura
    expect(comTexto(/\bJORNADA_PADRAO\s*(:\s*Jornada\s*)?=/)).toEqual([MOTOR]);
  });

  it("o sino e a lista de OS contam pelas mesmas funções; a régua de quem vê é a das OS", () => {
    expect(comTexto(/\bcontarAtendimento\(/, [SERVIDOR])).toEqual(["lib/prazo-server.ts"]);
    expect(comTexto(/\bidsPorAtendimento\(/, [SERVIDOR])).toEqual(["lib/listas/filtros-server.ts"]);
    const alertas = fonte("app/api/alertas/route.ts");
    expect(alertas).toMatch(/verOrdens/);
  });

  it("vocabulário: \"prazo de atendimento\" e \"prazo de execução\" têm cada um o seu nome nas telas — e \"SLA\" não aparece para o usuário", () => {
    const telas = ["app", "components"].flatMap(arquivos).filter((f) => /\.tsx$/.test(f));
    // "SLA" só sobra em comentário de código que explica um nome antigo
    const comSla = telas.filter((f) => fonte(f).split("\n").some((l) => /\bSLA\b/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) && !/\/\/.*\bSLA\b|\/\*\*.*\bSLA\b/.test(l)));
    expect(comSla).toEqual([]);
    expect(fonte("components/os/central/prazo-atendimento.tsx")).toContain("Prazo de atendimento");
    expect(fonte("components/os/central/prazo-atendimento.tsx")).not.toMatch(/Prazo de execução|Atrasad/);
    const lista = fonte("components/ordens/ordens-lista-client.tsx");
    expect(lista).toContain('aria-label="Prazo de execução"');
    expect(lista).toContain('aria-label="Prazo de atendimento"');
  });
});
