/**
 * PRAZOS DA OS — o motor (regras puras, sem banco). Dois conceitos que não se confundem:
 *  - PRAZO DE EXECUÇÃO (lib/os/prazo-execucao.ts): o prazo é o próprio ou, sem ele, o dia previsto;
 *    "atrasada" é UMA regra (dia de Brasília); o tipo de OS sugere o prazo em dias contados do dia
 *    agendado; o que a pessoa digita vence o padrão; o atraso justificado tem motivo de lista.
 *  - PRAZO DE ATENDIMENTO (lib/atendimento/prazo.ts): conta da abertura do chamado; horas corridas ou
 *    só de expediente; uma regra por prioridade (não se herda de outra); só chamado de cliente em
 *    contrato; avisa antes de estourar; cumprido no prazo × com atraso.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  MOTIVOS_ATRASO, MSG_ATRASO_OUTRO, ROTULO_MOTIVO_ATRASO, atrasoJustificado, atrasoJustificadoSchema, deslocarPrazo, lerPrazoDigitado, osAtrasada,
  prazoAoCriar, prazoDiasSchema, prazoEfetivo, prazoPadrao, rotuloMotivoAtraso, situacaoPrazoExecucao, temPrazoProprio, whereOsAtrasada,
} from "@/lib/os/prazo-execucao";
import {
  HORARIO_COMERCIAL, MSG_PRIORIDADE_REPETIDA, MSG_REGRA_VAZIA, MSG_RESOLVER_ANTES, atendimentoDaOs, duracaoCurta, limitesDoAtendimento,
  regraAtendimentoSchema, regraDaPrioridade, regrasAtendimentoSchema, situacaoAtendimento, somarHoras, temPrazoDeAtendimento, textoAtendimento,
} from "@/lib/atendimento/prazo";
import { mesDaPrevisao } from "@/lib/financeiro/a-faturar";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
/** Um instante dito no relógio de Brasília (UTC−3) */
const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);

/* ═════════ prazo de execução ═════════ */
describe("Prazo de execução — o prazo que vale", () => {
  it("o prazo próprio vence a data prevista; sem prazo próprio, vale o DIA previsto; sem nenhum dos dois, não há prazo", () => {
    expect(dia(prazoEfetivo({ prazoExecucao: new Date("2026-11-25T00:00:00Z"), previsaoConclusao: br("2026-11-20", "12:00") }))).toBe("2026-11-25");
    expect(dia(prazoEfetivo({ prazoExecucao: null, previsaoConclusao: new Date("2026-11-20T00:00:00Z") }))).toBe("2026-11-20");
    expect(prazoEfetivo({ prazoExecucao: null, previsaoConclusao: null })).toBeNull();
    expect(prazoEfetivo({})).toBeNull();
    expect([temPrazoProprio({ prazoExecucao: new Date("2026-11-25T00:00:00Z") }), temPrazoProprio({ previsaoConclusao: new Date() })]).toEqual([true, false]);
  });

  it("a data prevista com HORA vale o dia dela em Brasília (22h de Brasília ainda é o mesmo dia, mesmo já sendo o dia seguinte em UTC)", () => {
    const previsao = br("2026-11-20", "22:00"); // 21/11 01:00 em UTC
    expect(previsao.toISOString()).toBe("2026-11-21T01:00:00.000Z");
    expect(dia(prazoEfetivo({ previsaoConclusao: previsao }))).toBe("2026-11-20");
    // e o resultado é sempre um dia civil (meia-noite UTC), como a coluna guarda
    expect(iso(prazoEfetivo({ previsaoConclusao: previsao }))).toBe("2026-11-20T00:00:00.000Z");
  });

  it("atrasada é UMA regra: o dia de hoje em Brasília passou do dia do prazo, com a OS ainda aberta", () => {
    const os = { status: "AGENDADA", prazoExecucao: new Date("2026-11-17T00:00:00Z") };
    // 17/11 às 23h de Brasília: é o último minuto do prazo
    expect(situacaoPrazoExecucao(os, br("2026-11-17", "23:00")).situacao).toBe("VENCE_HOJE");
    expect(osAtrasada(os, br("2026-11-17", "23:00"))).toBe(false);
    // 18/11 00h30 de Brasília: atrasou 1 dia
    expect(situacaoPrazoExecucao(os, br("2026-11-18", "00:30"))).toMatchObject({ situacao: "ATRASADO", diasAtraso: 1 });
    expect(osAtrasada(os, br("2026-11-18", "00:30"))).toBe(true);
    expect(situacaoPrazoExecucao(os, br("2026-11-14", "10:00"))).toMatchObject({ situacao: "NO_PRAZO", diasRestantes: 3 });
    // OS encerrada não atrasa mais
    for (const status of ["CONCLUIDA", "CANCELADA"]) expect(osAtrasada({ ...os, status }, br("2026-12-01"))).toBe(false);
    for (const status of ["ABERTA", "AGUARDANDO_ATENDIMENTO", "EM_ANDAMENTO", "PAUSADA", "AGUARDANDO_PECA"]) expect(osAtrasada({ ...os, status }, br("2026-12-01")), status).toBe(true);
    // sem prazo e sem data prevista: nunca atrasa
    expect(osAtrasada({ status: "ABERTA" }, br("2030-01-01"))).toBe(false);
  });

  it("OS antiga (só com a data prevista) atrasa exatamente como antes; quando ganha prazo próprio, é ele que manda", () => {
    const agora = br("2026-11-18", "09:00");
    const antiga = { status: "AGENDADA", prazoExecucao: null, previsaoConclusao: br("2026-11-17", "12:00") };
    expect(osAtrasada(antiga, agora)).toBe(true);
    // o gestor dá mais prazo: a data prevista continua 17 (é agenda), mas a OS deixa de estar atrasada
    expect(osAtrasada({ ...antiga, prazoExecucao: new Date("2026-11-20T00:00:00Z") }, agora)).toBe(false);
    // e o contrário: marcada para o dia 25, com prazo no dia 15
    expect(osAtrasada({ status: "AGENDADA", prazoExecucao: new Date("2026-11-15T00:00:00Z"), previsaoConclusao: br("2026-11-25", "12:00") }, agora)).toBe(true);
  });

  it("a mesma regra como filtro do banco: aberta e com o prazo (ou, sem ele, a data prevista) antes de hoje em Brasília", () => {
    // 18/11 às 22h de Brasília já é 19/11 em UTC: "hoje" continua sendo 18
    expect(whereOsAtrasada(br("2026-11-18", "22:00"))).toEqual({
      status: { notIn: ["CONCLUIDA", "CANCELADA"] },
      OR: [
        { prazoExecucao: { lt: new Date("2026-11-18T00:00:00.000Z") } },
        // a data prevista vale como DIA (antes de hoje) ou como instante (antes do começo de hoje em
        // Brasília, 03:00 UTC) — menos o valor que é o próprio dia de hoje
        { prazoExecucao: null, previsaoConclusao: { lt: new Date("2026-11-18T03:00:00.000Z"), not: new Date("2026-11-18T00:00:00.000Z") } },
      ],
    });
  });
});

describe("Prazo de execução — o padrão do tipo de OS e o que se grava ao criar", () => {
  it("o padrão é o dia agendado (em Brasília) + N dias; 0 = o próprio dia", () => {
    expect(dia(prazoPadrao(br("2026-11-20", "09:00"), 0))).toBe("2026-11-20");
    expect(dia(prazoPadrao(br("2026-11-20", "09:00"), 3))).toBe("2026-11-23");
    expect(dia(prazoPadrao(br("2026-11-29", "09:00"), 5))).toBe("2026-12-04"); // vira o mês
    expect(dia(prazoPadrao(br("2026-12-30", "09:00"), 5))).toBe("2027-01-04"); // vira o ano
    // agendada às 22h de Brasília (já é o dia seguinte em UTC): o dia que conta é o de Brasília
    expect(dia(prazoPadrao(br("2026-11-20", "22:00"), 1))).toBe("2026-11-21");
    // a data só de dia (OS recorrente antiga) também serve
    expect(dia(prazoPadrao(new Date("2026-11-20T00:00:00Z"), 2))).toBe("2026-11-22");
    expect(iso(prazoPadrao(br("2026-11-20", "09:00"), 3))).toBe("2026-11-23T00:00:00.000Z");
  });

  it("sem padrão no tipo, ou sem dia agendado, não inventa prazo", () => {
    expect(prazoPadrao(br("2026-11-20", "09:00"), null)).toBeNull();
    expect(prazoPadrao(br("2026-11-20", "09:00"), undefined)).toBeNull();
    expect(prazoPadrao(null, 3)).toBeNull();
    expect(prazoPadrao(br("2026-11-20", "09:00"), -1)).toBeNull();
    expect(prazoPadrao(br("2026-11-20", "09:00"), 1.5)).toBeNull();
  });

  it("ao criar: o que a pessoa digitou vence o padrão do tipo; sem nada digitado, entra o padrão; sem padrão, fica vazio", () => {
    const agendada = br("2026-11-20", "09:00");
    expect(dia(prazoAoCriar({ digitado: new Date("2026-11-30T00:00:00Z"), dataAgendada: agendada, diasDoTipo: 3 }))).toBe("2026-11-30");
    expect(dia(prazoAoCriar({ digitado: null, dataAgendada: agendada, diasDoTipo: 3 }))).toBe("2026-11-23");
    expect(dia(prazoAoCriar({ dataAgendada: agendada, diasDoTipo: 3 }))).toBe("2026-11-23");
    expect(prazoAoCriar({ digitado: null, dataAgendada: agendada, diasDoTipo: null })).toBeNull();
    expect(prazoAoCriar({ digitado: null, dataAgendada: null, diasDoTipo: 3 })).toBeNull();
  });

  it("o prazo digitado: um dia (sem hora); vazio = sem prazo; lixo é recusado", () => {
    expect(iso(lerPrazoDigitado("2026-11-25") as Date)).toBe("2026-11-25T00:00:00.000Z");
    expect(iso(lerPrazoDigitado("2026-11-25T18:30:00.000Z") as Date)).toBe("2026-11-25T00:00:00.000Z"); // a hora é descartada
    expect([lerPrazoDigitado(""), lerPrazoDigitado(null), lerPrazoDigitado(undefined)]).toEqual([null, null, null]);
    expect(lerPrazoDigitado("amanhã")).toBeUndefined();
    expect(lerPrazoDigitado("20/11/2026")).toBeUndefined();
    // dia que não existe: o Date "ajustaria" para outro dia — aqui é recusado
    expect([lerPrazoDigitado("2026-02-31"), lerPrazoDigitado("2026-13-01"), lerPrazoDigitado("2026-11-00")]).toEqual([undefined, undefined, undefined]);
    expect(iso(lerPrazoDigitado("2028-02-29") as Date)).toBe("2028-02-29T00:00:00.000Z"); // bissexto existe
  });

  it("reagendamento feito pelo sistema (PMOC): o prazo próprio anda os mesmos dias, para frente ou para trás; sem prazo próprio, nada a mover", () => {
    const prazo = new Date("2026-11-27T00:00:00Z"); // agendada 25, prazo 27 (+2)
    expect(dia(deslocarPrazo(prazo, br("2026-11-25", "12:00"), br("2026-11-30", "12:00")))).toBe("2026-12-02");
    expect(dia(deslocarPrazo(prazo, br("2026-11-25", "12:00"), br("2026-11-23", "12:00")))).toBe("2026-11-25");
    // mesma data, outra hora: não anda — e o prazo continua sendo um DIA (meia-noite UTC), sem hora
    expect(iso(deslocarPrazo(prazo, br("2026-11-25", "12:00"), br("2026-11-25", "18:00")))).toBe("2026-11-27T00:00:00.000Z");
    // conta DIAS de Brasília: de 25 às 9h para 26 às 22h (já dia 27 em UTC) é 1 dia
    expect(iso(deslocarPrazo(prazo, br("2026-11-25", "09:00"), br("2026-11-26", "22:00")))).toBe("2026-11-28T00:00:00.000Z");
    // de 25 às 22h (dia 26 em UTC) para 26 às 9h: 1 dia de Brasília, embora o dia UTC seja o mesmo
    expect(iso(deslocarPrazo(prazo, br("2026-11-25", "22:00"), br("2026-11-26", "09:00")))).toBe("2026-11-28T00:00:00.000Z");
    expect(deslocarPrazo(null, br("2026-11-25"), br("2026-11-30"))).toBeNull();
    expect(deslocarPrazo(undefined, br("2026-11-25"), br("2026-11-30"))).toBeNull();
  });

  it("\"a faturar\": o mês é o da data prevista; OS só com prazo usa o mês do prazo (lido do próprio dia, sem fuso)", () => {
    const agora = br("2026-11-18", "10:00");
    expect(mesDaPrevisao({ previsaoConclusao: br("2026-12-05", "09:00"), prazoExecucao: new Date("2027-01-10T00:00:00Z"), status: "AGENDADA" }, agora).mes).toBe("2026-12");
    // dia 1º como dia civil (meia-noite UTC = 21h do dia 30 em Brasília): continua sendo dezembro
    expect(mesDaPrevisao({ previsaoConclusao: null, prazoExecucao: new Date("2026-12-01T00:00:00Z"), status: "ABERTA" }, agora).mes).toBe("2026-12");
    const semNada = mesDaPrevisao({ previsaoConclusao: null, prazoExecucao: null, status: "ABERTA" }, agora);
    expect(semNada.mes).toBe(mesDaPrevisao(null, agora).mes); // sem data nenhuma: como OS inexistente
    expect(mesDaPrevisao({ previsaoConclusao: null, prazoExecucao: new Date("2026-12-01T00:00:00Z"), status: "CANCELADA" }, agora).mes).toBe(semNada.mes);
  });

  it("o campo do tipo de OS: dias inteiros de 0 a 365; vazio = sem padrão", () => {
    const ler = (v: unknown) => { const r = prazoDiasSchema.safeParse(v); return r.success ? r.data : r.error.issues[0].message; };
    expect([ler(""), ler(undefined), ler(null), ler(0), ler(5), ler(365)]).toEqual([null, null, null, 0, 5, 365]);
    expect(ler(-1)).toBe("Prazo padrão: não pode ser negativo.");
    expect(ler(1.5)).toBe("Prazo padrão: use dias inteiros.");
    expect(ler(366)).toBe("Prazo padrão: no máximo 365 dias.");
    expect(ler("3")).toBe("Prazo padrão: informe um número de dias.");
  });
});

describe("Atraso justificado — o motivo é de uma lista", () => {
  it("cinco motivos com nome; \"Outro\" exige a explicação", () => {
    expect([...MOTIVOS_ATRASO]).toEqual(["CLIENTE_AUSENTE", "PECA_FALTANDO", "ACESSO_NEGADO", "CLIMA", "OUTRO"]);
    expect(MOTIVOS_ATRASO.map((m) => ROTULO_MOTIVO_ATRASO[m])).toEqual(["Cliente ausente", "Peça faltando", "Acesso ao local negado", "Chuva ou clima", "Outro motivo"]);
    const ler = (v: unknown) => { const r = atrasoJustificadoSchema.safeParse(v); return r.success ? r.data : r.error.issues[0].message; };
    expect(ler({ motivo: "CLIENTE_AUSENTE" })).toEqual({ motivo: "CLIENTE_AUSENTE", observacao: "" });
    expect(ler({ motivo: "PECA_FALTANDO", observacao: "  compressor em falta  " })).toEqual({ motivo: "PECA_FALTANDO", observacao: "compressor em falta" });
    expect(ler({ motivo: "OUTRO" })).toBe(MSG_ATRASO_OUTRO);
    expect(ler({ motivo: "OUTRO", observacao: "   " })).toBe(MSG_ATRASO_OUTRO);
    // "razão é razão": a explicação precisa dizer alguma coisa (5 caracteres no mínimo, sem contar os espaços das pontas)
    expect(MSG_ATRASO_OUTRO).toBe("Explique o motivo do atraso (pelo menos 5 caracteres).");
    expect(ler({ motivo: "OUTRO", observacao: "   x    " })).toBe(MSG_ATRASO_OUTRO); // espaço não conta
    expect(ler({ motivo: "OUTRO", observacao: "obra" })).toBe(MSG_ATRASO_OUTRO);
    expect(ler({ motivo: "OUTRO", observacao: "greve" })).toEqual({ motivo: "OUTRO", observacao: "greve" });
    expect(ler({ motivo: "CLIMA", observacao: "x" })).toEqual({ motivo: "CLIMA", observacao: "x" }); // nos motivos da lista a explicação é livre
    expect(ler({ motivo: "OUTRO", observacao: "Greve dos caminhoneiros" })).toEqual({ motivo: "OUTRO", observacao: "Greve dos caminhoneiros" });
    expect(ler({ motivo: "PREGUICA" })).toBe("Escolha o motivo do atraso.");
    expect(ler({})).toBe("Escolha o motivo do atraso.");
    expect(ler({ motivo: "CLIMA", observacao: "x".repeat(501) })).toBe("Explicação com no máximo 500 caracteres.");
  });

  it("a OS está justificada quando tem motivo gravado", () => {
    expect([atrasoJustificado({ atrasoJustificadoMotivo: "CLIMA" }), atrasoJustificado({ atrasoJustificadoMotivo: null }), atrasoJustificado({})]).toEqual([true, false, false]);
    expect([rotuloMotivoAtraso("ACESSO_NEGADO"), rotuloMotivoAtraso("DESCONHECIDO"), rotuloMotivoAtraso(null)]).toEqual(["Acesso ao local negado", "", ""]);
  });
});

/* ═════════ prazo de atendimento ═════════ */
describe("Prazo de atendimento — horas corridas e horas de expediente", () => {
  it("corridas: o relógio, inclusive de noite e no fim de semana", () => {
    expect(iso(somarHoras(br("2026-11-20", "17:00"), 4))).toBe(iso(br("2026-11-20", "21:00")));
    expect(iso(somarHoras(br("2026-11-20", "22:00"), 24))).toBe(iso(br("2026-11-21", "22:00"))); // sexta → sábado
    expect(iso(somarHoras(br("2026-11-20", "17:00"), 4, false))).toBe(iso(br("2026-11-20", "21:00")));
  });

  it("o expediente é segunda a sexta, das 8h às 18h de Brasília", () => {
    expect(HORARIO_COMERCIAL).toEqual({ inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5] });
  });

  it("só em horário comercial: chamado de sexta às 17h com 4 h vence segunda às 11h", () => {
    // 20/11/2026 é sexta-feira
    expect(iso(somarHoras(br("2026-11-20", "17:00"), 4, true))).toBe(iso(br("2026-11-23", "11:00")));
  });

  it("só em horário comercial: aberto fora do expediente começa a contar na próxima abertura", () => {
    expect(iso(somarHoras(br("2026-11-21", "10:00"), 2, true))).toBe(iso(br("2026-11-23", "10:00"))); // sábado → segunda 8h + 2
    expect(iso(somarHoras(br("2026-11-22", "23:00"), 1, true))).toBe(iso(br("2026-11-23", "09:00"))); // domingo à noite
    expect(iso(somarHoras(br("2026-11-23", "07:00"), 1, true))).toBe(iso(br("2026-11-23", "09:00"))); // segunda antes das 8h
    expect(iso(somarHoras(br("2026-11-23", "18:00"), 1, true))).toBe(iso(br("2026-11-24", "09:00"))); // na hora em que fecha
    expect(iso(somarHoras(br("2026-11-23", "19:30"), 3, true))).toBe(iso(br("2026-11-24", "11:00"))); // depois de fechar
  });

  it("só em horário comercial: atravessa vários dias contando só as 10 h de cada um", () => {
    // quarta 12h + 24 h úteis = 6 h (qua) + 10 h (qui) + 8 h (sex) → sexta às 16h
    expect(iso(somarHoras(br("2026-11-18", "12:00"), 24, true))).toBe(iso(br("2026-11-20", "16:00")));
    // o dia inteiro cabe até a hora de fechar (não pula para o dia seguinte)
    expect(iso(somarHoras(br("2026-11-18", "08:00"), 10, true))).toBe(iso(br("2026-11-18", "18:00")));
    expect(iso(somarHoras(br("2026-11-18", "08:00"), 11, true))).toBe(iso(br("2026-11-19", "09:00")));
    // 40 h úteis a partir de sexta 8h = sexta + segunda a quarta → quarta às 18h
    expect(iso(somarHoras(br("2026-11-20", "08:00"), 40, true))).toBe(iso(br("2026-11-25", "18:00")));
    // minutos também contam
    expect(iso(somarHoras(br("2026-11-20", "17:45"), 1, true))).toBe(iso(br("2026-11-23", "08:45")));
  });
});

describe("Prazo de atendimento — o que o contrato promete", () => {
  const REGRAS = [
    { prioridade: "URGENTE", comparecerHoras: 4, resolverHoras: 24, soHorarioComercial: false },
    { prioridade: "NORMAL", comparecerHoras: 24, resolverHoras: null, soHorarioComercial: true },
  ];

  it("vale a regra da PRÓPRIA prioridade; prioridade que o contrato não configurou não tem prazo (não herda de outra)", () => {
    expect(regraDaPrioridade(REGRAS, "URGENTE")).toBe(REGRAS[0]);
    expect(regraDaPrioridade(REGRAS, "NORMAL")).toBe(REGRAS[1]);
    for (const p of ["BAIXA", "ALTA", "CRITICO", "QUALQUER"]) expect(regraDaPrioridade(REGRAS, p), p).toBeNull();
    expect(regraDaPrioridade([], "URGENTE")).toBeNull();
  });

  it("os limites contam da abertura do chamado; emergência corre 24 h, o normal pode contar só o expediente", () => {
    const aberto = br("2026-11-20", "17:00"); // sexta
    expect(limitesDoAtendimento(aberto, REGRAS[0])).toEqual({ comparecerAte: br("2026-11-20", "21:00"), resolverAte: br("2026-11-21", "17:00") });
    // normal, 24 h úteis: 1 h (sex) + 10 (seg) + 10 (ter) + 3 (qua) → quarta às 11h; sem prazo para resolver
    expect(limitesDoAtendimento(aberto, REGRAS[1])).toEqual({ comparecerAte: br("2026-11-25", "11:00"), resolverAte: null });
    expect(limitesDoAtendimento(aberto, null)).toEqual({ comparecerAte: null, resolverAte: null });
  });

  it("a linha do contrato: horas inteiras; ao menos um dos dois prazos; resolver não pode ser menor que comparecer", () => {
    const ler = (v: unknown) => { const r = regraAtendimentoSchema.safeParse(v); return r.success ? r.data : r.error.issues[0].message; };
    expect(ler({ prioridade: "URGENTE", comparecerHoras: 4, resolverHoras: 24 })).toEqual({ prioridade: "URGENTE", comparecerHoras: 4, resolverHoras: 24, soHorarioComercial: false });
    expect(ler({ prioridade: "NORMAL", comparecerHoras: 24, resolverHoras: "", soHorarioComercial: true })).toEqual({ prioridade: "NORMAL", comparecerHoras: 24, resolverHoras: null, soHorarioComercial: true });
    expect(ler({ prioridade: "ALTA", comparecerHoras: "", resolverHoras: 48 })).toMatchObject({ comparecerHoras: null, resolverHoras: 48 });
    expect(ler({ prioridade: "ALTA", comparecerHoras: "", resolverHoras: "" })).toBe(MSG_REGRA_VAZIA);
    expect(ler({ prioridade: "ALTA", comparecerHoras: 24, resolverHoras: 4 })).toBe(MSG_RESOLVER_ANTES);
    expect(ler({ prioridade: "ALTA", comparecerHoras: 4, resolverHoras: 4 })).toMatchObject({ comparecerHoras: 4, resolverHoras: 4 });
    expect(ler({ prioridade: "EMERGENCIAL", comparecerHoras: 4 })).toBe("Prioridade inválida.");
    expect(ler({ prioridade: "ALTA", comparecerHoras: 0 })).toBe("Comparecer: mínimo 1 hora.");
    expect(ler({ prioridade: "ALTA", resolverHoras: 1.5 })).toBe("Resolver: use horas inteiras.");
    expect(ler({ prioridade: "ALTA", comparecerHoras: 9000 })).toBe("Comparecer: no máximo 8760 horas.");
  });

  it("no máximo uma linha por prioridade", () => {
    const ok = regrasAtendimentoSchema.safeParse([{ prioridade: "URGENTE", comparecerHoras: 4 }, { prioridade: "NORMAL", comparecerHoras: 24 }]);
    expect(ok.success).toBe(true);
    const repetida = regrasAtendimentoSchema.safeParse([{ prioridade: "URGENTE", comparecerHoras: 4 }, { prioridade: "URGENTE", comparecerHoras: 8 }]);
    expect(repetida.success ? null : repetida.error.issues.map((i) => [i.path.join("."), i.message])).toEqual([["1.prioridade", MSG_PRIORIDADE_REPETIDA]]);
    expect(regrasAtendimentoSchema.safeParse([]).success).toBe(true); // contrato sem promessa de prazo
  });

  it("só o chamado de cliente em contrato tem prazo de atendimento; a preventiva recorrente não", () => {
    const aberto = br("2026-11-20", "09:00");
    expect(temPrazoDeAtendimento({ contratoId: "ct1", origem: "PORTAL_CLIENTE", chamadoAbertoEm: aberto })).toBe(true);
    expect(temPrazoDeAtendimento({ contratoId: "ct1", origem: "MANUAL", chamadoAbertoEm: aberto })).toBe(true); // lançado à mão como chamado
    expect(temPrazoDeAtendimento({ contratoId: "ct1", origem: "RECORRENTE", chamadoAbertoEm: aberto })).toBe(false);
    expect(temPrazoDeAtendimento({ contratoId: null, origem: "PORTAL_CLIENTE", chamadoAbertoEm: aberto })).toBe(false); // sem contrato
    expect(temPrazoDeAtendimento({ contratoId: "ct1", origem: "MANUAL", chamadoAbertoEm: null })).toBe(false); // OS comum
  });
});

describe("Prazo de atendimento — a situação agora", () => {
  const aberto = br("2026-11-20", "08:00");
  const limite = br("2026-11-20", "18:00"); // 10 h de prazo → avisa nos últimos 20% (2 h)

  it("no prazo → vencendo (últimos 20%) → estourado, com os minutos certos", () => {
    const s = (hora: string) => { const p = situacaoAtendimento({ limite, abertoEm: aberto }, br("2026-11-20", hora)); return `${p.situacao}:${p.minutos}`; };
    expect(s("09:00")).toBe("NO_PRAZO:540");
    expect(s("15:59")).toBe("NO_PRAZO:121");
    expect(s("16:00")).toBe("VENCENDO:120");
    expect(s("17:59")).toBe("VENCENDO:1");
    expect(s("18:00")).toBe("VENCENDO:0");
    expect(s("18:01")).toBe("ESTOURADO:1");
    expect(s("21:00")).toBe("ESTOURADO:180");
  });

  it("prazo curto: o aviso nunca é menor que 1 hora", () => {
    const curto = br("2026-11-20", "10:00"); // 2 h de prazo: 20% seriam 24 min
    const s = (hora: string) => situacaoAtendimento({ limite: curto, abertoEm: aberto }, br("2026-11-20", hora)).situacao;
    expect([s("08:30"), s("08:59"), s("09:00"), s("09:59")]).toEqual(["NO_PRAZO", "NO_PRAZO", "VENCENDO", "VENCENDO"]);
  });

  it("cumprido no prazo × cumprido com atraso; sem limite não há prazo", () => {
    expect(situacaoAtendimento({ limite, cumpridoEm: br("2026-11-20", "12:00") }, br("2026-11-25"))).toMatchObject({ situacao: "CUMPRIDO", minutos: 0 });
    expect(situacaoAtendimento({ limite, cumpridoEm: limite }, br("2026-11-25"))).toMatchObject({ situacao: "CUMPRIDO", minutos: 0 }); // no último minuto
    expect(situacaoAtendimento({ limite, cumpridoEm: br("2026-11-20", "19:30") }, br("2026-11-25"))).toMatchObject({ situacao: "CUMPRIDO_FORA", minutos: 90 });
    expect(situacaoAtendimento({ limite: null }, br("2026-11-25"))).toMatchObject({ situacao: "SEM_PRAZO", limite: null });
  });

  it("o texto diz quanto falta ou há quanto estourou", () => {
    const t = (min: number, situacao: any = "NO_PRAZO") => textoAtendimento({ situacao, limite, cumpridoEm: null, minutos: min });
    expect([t(540), t(121), t(90), t(60), t(40), t(1), t(0)]).toEqual(["faltam 9 h", "faltam 2 h 1 min", "falta 1 h 30 min", "falta 1 h", "faltam 40 min", "faltam 1 min", "vence agora"]);
    expect([t(40, "ESTOURADO"), t(180, "ESTOURADO"), t(3000, "ESTOURADO")]).toEqual(["estourou há 40 min", "estourou há 3 h", "estourou há 2 dias"]);
    expect([t(0, "CUMPRIDO"), t(90, "CUMPRIDO_FORA"), t(0, "SEM_PRAZO")]).toEqual(["cumprido no prazo", "cumprido com 1 h 30 min de atraso", "sem prazo"]);
    expect([duracaoCurta(59), duracaoCurta(60), duracaoCurta(61), duracaoCurta(6 * 60 + 20), duracaoCurta(47 * 60), duracaoCurta(48 * 60), duracaoCurta(-5)])
      .toEqual(["59 min", "1 h", "1 h 1 min", "6 h", "47 h", "2 dias", "0 min"]);
  });

  it("na OS: comparecer se cumpre com o \"Cheguei\"; resolver, com a OS concluída (reabrir a OS reabre o prazo)", () => {
    const os = {
      chamadoAbertoEm: aberto, atendimentoComparecerAte: br("2026-11-20", "12:00"), atendimentoResolverAte: limite,
      atendimentoComparecidoEm: null as Date | null, dataConclusao: null as Date | null, status: "AGENDADA",
    };
    const agora = br("2026-11-20", "11:30");
    const r = (o: typeof os) => { const a = atendimentoDaOs(o, agora); return [a.comparecer.situacao, a.resolver.situacao]; };
    expect(r(os)).toEqual(["VENCENDO", "NO_PRAZO"]);
    expect(r({ ...os, atendimentoComparecidoEm: br("2026-11-20", "11:00"), status: "EM_ANDAMENTO" })).toEqual(["CUMPRIDO", "NO_PRAZO"]);
    expect(r({ ...os, atendimentoComparecidoEm: br("2026-11-20", "13:00") })).toEqual(["CUMPRIDO_FORA", "NO_PRAZO"]);
    expect(r({ ...os, atendimentoComparecidoEm: br("2026-11-20", "11:00"), dataConclusao: br("2026-11-20", "11:20"), status: "CONCLUIDA" })).toEqual(["CUMPRIDO", "CUMPRIDO"]);
    // OS reaberta: a data de conclusão antiga não vale mais
    expect(r({ ...os, dataConclusao: br("2026-11-20", "11:20"), status: "EM_ANDAMENTO" })).toEqual(["VENCENDO", "NO_PRAZO"]);
    // OS sem prazo de atendimento
    expect(r({ ...os, atendimentoComparecerAte: null as any, atendimentoResolverAte: null as any })).toEqual(["SEM_PRAZO", "SEM_PRAZO"]);
  });
});

/* ═════════ quem lê: ninguém decide "atrasada" por conta própria ═════════ */
describe("Prazo de execução — a regra de \"atrasada\" mora num lugar só", () => {
  const RAIZ = path.resolve(__dirname, "../..");
  const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
  const arquivos = (dir: string): string[] => readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? arquivos(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);

  it("nenhum arquivo compara a data prevista com hoje para dizer que a OS atrasou (só o Portal, que fala de VISITA a reagendar)", () => {
    // No Portal do cliente, "a visita era dia X — a reagendar" é agenda (a data prevista), não prazo
    const AGENDA_DO_PORTAL = ["app/(portal)/portal/(protegido)/agenda/page.tsx", "app/(portal)/portal/(protegido)/dashboard/page.tsx"];
    const suspeitos = ["app", "lib", "components"].flatMap(arquivos)
      .filter((f) => f !== "lib/os/prazo-execucao.ts" && !AGENDA_DO_PORTAL.includes(f))
      .filter((f) => /previsaoConclusao:\s*\{\s*lt\b/.test(fonte(f)) || /prazoVencido\(\s*os\.previsaoConclusao/.test(fonte(f)));
    expect(suspeitos).toEqual([]);
  });

  it("calendário, dashboard, sino, assistente e relatório de contratos usam a regra única", () => {
    const calendario = fonte("app/(dashboard)/calendario/page.tsx");
    expect(calendario).toContain("const atrasada = osAtrasada(os, hoje);");
    // sem atividade no período a OS fica na data prevista ou, sem ela, no dia do prazo — e a consulta traz as duas
    expect(calendario).toContain("const semAtividade = os.previsaoConclusao ?? os.prazoExecucao;");
    expect(calendario).toContain("{ previsaoConclusao: null, prazoExecucao: periodoDia }");
    expect(fonte("lib/dashboard/dados.ts")).toContain("where: { empresaId, ...whereOsAtrasada(agora) }");
    expect(fonte("lib/prazo-server.ts")).toContain("where: { empresaId, ...whereOsAtrasada(agora) }");
    expect(fonte("lib/ia/ferramentas.ts").match(/whereOsAtrasada\(agora\)\.OR/g)).toHaveLength(2);
    expect(fonte("app/(dashboard)/contratos/relatorio/page.tsx")).toContain("diaCivilPassou(prazoEfetivo(os), agora)");
    expect(fonte("lib/os/central.ts")).toContain("situacaoPrazo(prazoEfetivo(os), encerrada, agora)");
  });

  it("o status automático \"Agendada\" continua dependendo só da DATA PREVISTA (um prazo não agenda nada)", () => {
    const status = fonte("lib/os/status.ts");
    expect(status).toContain('if (!ativas.length && os.previsaoConclusao) return "AGENDADA";');
    expect(status).not.toContain("prazoExecucao");
  });
});
