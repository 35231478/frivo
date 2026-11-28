/**
 * App de campo, leva 1 (PR 2) — REGRAS PURAS:
 *  - atividade esquecida em andamento: limite por empresa (padrão 4 h), fim do expediente e "outro dia";
 *  - concluir com tempo suspeito: término sugerido (última gravação), validação do término informado;
 *  - reabrir recomeça a contagem;
 *  - o topo da OS: ligar/WhatsApp em 1 toque, "Detalhes" com o dado de escritório.
 */
import { describe, expect, it } from "vitest";
import {
  ALERTA_HORAS_PADRAO, duracaoTexto, expedienteDoDia, FOLGA_TERMINO_MS, historicoTermino, horarioNoDia, inicioDaAtividade, limiteHoras, limiteHorasSchema,
  marcaDeInicio, situacaoAndamento, sugerirTermino, tempoSuspeito, terminoValido, textoAlerta, ultimaDe,
} from "@/lib/tecnico/andamento";
import { detalhesDaOs, linkTelefone, linkWhatsapp, resumoEquipamentos } from "@/lib/tecnico/topo-os";
import { CONFIG_APP_PADRAO, configAppParaPayload, normalizarConfigApp, SELECT_CONFIG_APP } from "@/lib/tecnico/config-app";
import { JORNADA_PADRAO, type Jornada } from "@/lib/atendimento/prazo";
import type { CartaoTela } from "@/lib/tecnico/offline/tipos";

/** Instante em Brasília (UTC−3): "2026-11-12 10:00" (quinta-feira) */
const br = (s: string) => new Date(`${s.replace(" ", "T")}:00-03:00`);
const MIN = 60_000, H = 60 * MIN;

describe("limite por empresa", () => {
  it("padrão 4 h; fora de 1..24 ou não inteiro = padrão", () => {
    expect(ALERTA_HORAS_PADRAO).toBe(4);
    expect(limiteHoras(6)).toBe(6);
    expect(limiteHoras(1)).toBe(1);
    expect(limiteHoras(24)).toBe(24);
    for (const v of [0, 25, 2.5, -1, null, undefined, "6", NaN]) expect(limiteHoras(v), String(v)).toBe(4);
    expect(limiteHorasSchema.safeParse(0).success).toBe(false);
    expect(limiteHorasSchema.safeParse(25).success).toBe(false);
    expect(limiteHorasSchema.safeParse(2.5).success).toBe(false);
    expect(limiteHorasSchema.safeParse(12).success).toBe(true);
  });
  it("entra no ConfigApp: padrão, leitura do banco e ida para o PUT", () => {
    expect(CONFIG_APP_PADRAO.alertaAndamentoHoras).toBe(4);
    expect(normalizarConfigApp(null).alertaAndamentoHoras).toBe(4);
    expect(normalizarConfigApp({ appAlertaAndamentoHoras: 8 }).alertaAndamentoHoras).toBe(8);
    expect(normalizarConfigApp({ appAlertaAndamentoHoras: 99 }).alertaAndamentoHoras).toBe(4);
    expect(configAppParaPayload({ ...CONFIG_APP_PADRAO, alertaAndamentoHoras: 6 }).appAlertaAndamentoHoras).toBe(6);
    expect(SELECT_CONFIG_APP.appAlertaAndamentoHoras).toBe(true);
  });
});

describe("quando começou", () => {
  it("a coluna nova; sem ela (atividade antiga), a hora agendada; sem nada, null", () => {
    expect(inicioDaAtividade({ iniciadaEm: "2026-11-12T13:00:00Z", dataAgendada: "2026-11-12T11:00:00Z" })!.toISOString()).toBe("2026-11-12T13:00:00.000Z");
    expect(inicioDaAtividade({ iniciadaEm: null, dataAgendada: "2026-11-12T11:00:00Z" })!.toISOString()).toBe("2026-11-12T11:00:00.000Z");
    expect(inicioDaAtividade({})).toBeNull();
  });
  it("reabrir (ou qualquer volta a EM_ANDAMENTO) recomeça; continuar em andamento não mexe", () => {
    const q = new Date("2026-11-12T15:00:00Z");
    expect(marcaDeInicio("CONCLUIDA", "EM_ANDAMENTO", q)).toEqual({ iniciadaEm: q });
    expect(marcaDeInicio("AGENDADA", "EM_ANDAMENTO", q)).toEqual({ iniciadaEm: q });
    expect(marcaDeInicio("EM_ANDAMENTO", "EM_ANDAMENTO", q)).toEqual({});
    expect(marcaDeInicio("EM_ANDAMENTO", "CONCLUIDA", q)).toEqual({});
  });
});

describe("aviso ao técnico: atividade esquecida em andamento", () => {
  const sit = (inicio: string, agora: string, extra: { status?: string; limite?: number; jornada?: Jornada | null } = {}) =>
    situacaoAndamento({ status: extra.status ?? "EM_ANDAMENTO", inicio: br(inicio), agora: br(agora), limiteHoras: extra.limite ?? 4, jornada: extra.jornada });

  it("antes do limite: nada; no limite (exato) e depois: 'limite'", () => {
    expect(sit("2026-11-12 08:00", "2026-11-12 11:59")).toEqual({ alerta: null, minutos: 239 });
    expect(sit("2026-11-12 08:00", "2026-11-12 12:00")).toEqual({ alerta: "limite", minutos: 240 });
    expect(sit("2026-11-12 08:00", "2026-11-12 13:10")).toEqual({ alerta: "limite", minutos: 310 });
    // Limite da empresa: 6 h
    expect(sit("2026-11-12 08:00", "2026-11-12 13:10", { limite: 6 }).alerta).toBeNull();
  });
  it("fim do expediente (jornada da empresa): avisa mesmo antes do limite; sem expediente no dia, não", () => {
    expect(sit("2026-11-12 16:00", "2026-11-12 18:00")).toEqual({ alerta: "fim-do-dia", minutos: 120 });
    expect(sit("2026-11-12 16:00", "2026-11-12 17:59").alerta).toBeNull();
    const ate16: Jornada = [null, ...Array.from({ length: 5 }, () => ({ inicio: 480, fim: 960 })), null];
    expect(sit("2026-11-12 15:00", "2026-11-12 16:00", { jornada: ate16 }).alerta).toBe("fim-do-dia");
    // Sábado (sem expediente na jornada padrão): só o limite vale
    expect(sit("2026-11-14 16:00", "2026-11-14 19:00").alerta).toBeNull();
    expect(expedienteDoDia(null, br("2026-11-14 10:00"))).toBeNull();
    expect(expedienteDoDia(JORNADA_PADRAO, br("2026-11-12 10:00"))).toEqual({ inicio: 480, fim: 1080 });
  });
  it("começou em OUTRO DIA: avisa sempre (vence os outros motivos), mesmo pouco tempo depois", () => {
    expect(sit("2026-11-11 23:30", "2026-11-12 00:30")).toEqual({ alerta: "outro-dia", minutos: 60 });
    expect(sit("2026-11-11 08:00", "2026-11-12 19:00").alerta).toBe("outro-dia");
  });
  it("só EM_ANDAMENTO; sem início conhecido, nada", () => {
    expect(sit("2026-11-12 01:00", "2026-11-12 19:00", { status: "AGENDADA" }).alerta).toBeNull();
    expect(sit("2026-11-11 01:00", "2026-11-12 19:00", { status: "CONCLUIDA" }).alerta).toBeNull();
    expect(situacaoAndamento({ status: "EM_ANDAMENTO", inicio: null, agora: Date.now(), limiteHoras: 4 })).toEqual({ alerta: null, minutos: 0 });
  });
  it("o texto: curto, sem exclamação", () => {
    expect(duracaoTexto(45)).toBe("45 min");
    expect(duracaoTexto(300)).toBe("5 h");
    expect(duracaoTexto(310)).toBe("5 h 10 min");
    expect(textoAlerta({ alerta: "limite", minutos: 310 })).toBe("Em andamento há 5 h 10 min.");
    expect(textoAlerta({ alerta: "fim-do-dia", minutos: 120 })).toBe("Expediente encerrado. Em andamento há 2 h.");
    expect(textoAlerta({ alerta: "outro-dia", minutos: 2000 })).toBe("Começou em outro dia e continua em andamento.");
    expect(textoAlerta({ alerta: null, minutos: 10 })).toBeNull();
  });
});

describe("concluir com tempo suspeito", () => {
  it("suspeito: passou do limite ou virou o dia", () => {
    expect(tempoSuspeito(br("2026-11-12 08:00"), br("2026-11-12 11:59"), 4)).toBe(false);
    expect(tempoSuspeito(br("2026-11-12 08:00"), br("2026-11-12 12:00"), 4)).toBe(true);
    expect(tempoSuspeito(br("2026-11-11 23:50"), br("2026-11-12 00:10"), 4)).toBe(true);
    expect(tempoSuspeito(br("2026-11-12 08:00"), br("2026-11-12 13:00"), 6)).toBe(false);
    expect(tempoSuspeito(null, br("2026-11-12 13:00"), 4)).toBe(false);
  });
  it("término sugerido = a última gravação, se ficou entre o início e o toque", () => {
    const ini = br("2026-11-11 14:00"), toque = br("2026-11-12 08:00");
    expect(sugerirTermino(ini, br("2026-11-11 16:20"), toque)!.getTime()).toBe(br("2026-11-11 16:20").getTime());
    expect(sugerirTermino(ini, br("2026-11-11 13:59"), toque)).toBeNull();
    expect(sugerirTermino(ini, br("2026-11-12 08:01"), toque)).toBeNull();
    expect(sugerirTermino(ini, null, toque)).toBeNull();
    expect(sugerirTermino(null, br("2026-11-11 16:20"), toque)).toBeNull();
    // Nos extremos vale
    expect(sugerirTermino(ini, ini, toque)).not.toBeNull();
    expect(sugerirTermino(ini, toque, toque)).not.toBeNull();
  });
  it("a última gravação: a maior data válida", () => {
    expect(ultimaDe(["2026-11-12T10:00:00Z", null, "2026-11-12T12:00:00Z", undefined, "lixo", new Date("2026-11-12T11:00:00Z")])!.toISOString()).toBe("2026-11-12T12:00:00.000Z");
    expect(ultimaDe([null, undefined])).toBeNull();
  });
  it("término informado: entre o início e o toque (com folga de relógio)", () => {
    const ini = br("2026-11-12 08:00"), toque = br("2026-11-12 18:00");
    expect(terminoValido(br("2026-11-12 12:00"), ini, toque)).toBe(true);
    expect(terminoValido(ini, ini, toque)).toBe(true);
    expect(terminoValido(br("2026-11-12 07:59"), ini, toque)).toBe(false);
    expect(terminoValido(new Date(toque.getTime() + FOLGA_TERMINO_MS), ini, toque)).toBe(true);
    expect(terminoValido(new Date(toque.getTime() + FOLGA_TERMINO_MS + 1000), ini, toque)).toBe(false);
    expect(terminoValido("lixo", ini, toque)).toBe(false);
    expect(terminoValido(br("2026-11-12 03:00"), null, toque)).toBe(true); // sem início: só o teto
    expect(FOLGA_TERMINO_MS).toBe(2 * MIN);
  });
  it("hora digitada vira instante no dia (Brasília)", () => {
    expect(horarioNoDia("16:20", br("2026-11-11 09:00"))!.getTime()).toBe(br("2026-11-11 16:20").getTime());
    expect(horarioNoDia(" 07:05 ", br("2026-11-12 23:00"))!.getTime()).toBe(br("2026-11-12 07:05").getTime());
    for (const v of ["", "24:00", "7:5", "ab:cd", "12:60"]) expect(horarioNoDia(v, Date.now()), v).toBeNull();
  });
  it("o histórico diz o término e a hora do toque (com a data quando é outro dia)", () => {
    expect(historicoTermino(br("2026-11-12 16:20"), br("2026-11-12 18:05"))).toBe("Término informado pelo técnico: 16:20 (concluída no app às 18:05)");
    expect(historicoTermino(br("2026-11-11 16:20"), br("2026-11-12 08:05"))).toBe("Término informado pelo técnico: 16:20 de 11/11/2026 (concluída no app às 08:05)");
  });
});

describe("topo da OS", () => {
  it("ligar e WhatsApp em 1 toque (número curto = sem botão; WhatsApp com DDI do Brasil)", () => {
    expect(linkTelefone("(11) 3333-0000")).toBe("tel:1133330000");
    expect(linkTelefone("+55 11 99999-0000")).toBe("tel:+5511999990000");
    expect(linkTelefone("123")).toBeNull();
    expect(linkTelefone(null)).toBeNull();
    expect(linkWhatsapp("(11) 96666-5555")).toBe("https://wa.me/5511966665555");
    expect(linkWhatsapp("+55 (11) 96666-5555")).toBe("https://wa.me/5511966665555");
    expect(linkWhatsapp("96666-5555")).toBeNull();
    expect(linkWhatsapp(undefined)).toBeNull();
  });
  it("Detalhes: o dado de escritório, na ordem, só o que existe; unidade só com dados do cliente", () => {
    const c = {
      hora: "09:00", duracaoMin: 90, unidade: "Matriz", prioridade: "ALTA", origem: "PORTAL_CLIENTE", criadoPor: "Ana Escritório",
      visita: { numero: 3, total: 12 }, orientacao: "Entrar pela portaria 2.",
    } as unknown as CartaoTela;
    expect(detalhesDaOs(c, { titulo: "Preventiva", verDados: true })).toEqual([
      { rotulo: "Atividade", valor: "Preventiva" }, { rotulo: "Horário", valor: "09:00 · 90 min" }, { rotulo: "Unidade", valor: "Matriz" },
      { rotulo: "Prioridade", valor: "Alta" }, { rotulo: "Origem", valor: "Chamado do cliente" }, { rotulo: "Aberta por", valor: "Ana Escritório" },
      { rotulo: "Visita", valor: "3 de 12" }, { rotulo: "Orientação do escritório", valor: "Entrar pela portaria 2." },
    ]);
    expect(detalhesDaOs(c, { titulo: null, verDados: false }).map((d) => d.rotulo)).not.toContain("Unidade");
    const vazio = { prioridade: "NORMAL", orientacao: "  " } as unknown as CartaoTela;
    expect(detalhesDaOs(vazio, { titulo: null, verDados: true })).toEqual([{ rotulo: "Prioridade", valor: "Normal" }]);
    expect(detalhesDaOs({ prioridade: "X", origem: "RECORRENTE", hora: "07:00" } as unknown as CartaoTela, { titulo: "", verDados: true }))
      .toEqual([{ rotulo: "Horário", valor: "07:00" }, { rotulo: "Prioridade", valor: "X" }, { rotulo: "Origem", valor: "Recorrente (contrato/PMOC)" }]);
  });
  it("resumo dos equipamentos", () => {
    // D14: "começado" e "completo" (antes: "atendido", que contava o começado)
    expect(resumoEquipamentos(0, 0, 0)).toBe("Nenhum equipamento");
    expect(resumoEquipamentos(1, 1, 1)).toBe("1 equipamento · 1 começado · 1 completo");
    expect(resumoEquipamentos(3, 0, 0)).toBe("3 equipamentos · 0 começados · 0 completos");
  });
});

it("constante de horas", () => { expect(H).toBe(3_600_000); });
