// @vitest-environment happy-dom
/**
 * CHAT-1.2 — situação e presença do técnico (o que o escritório vê), as regras puras e a linha na tela:
 *  - cada situação e a PRIORIDADE: pausada > em execução > a caminho > fora do expediente > sem atividade;
 *  - a jornada em faixas (dia da semana, intervalo conta como dentro, sem jornada nunca é "fora");
 *  - a presença: ponto verde até 2 min, "visto por último" (hoje, ontem, data), "Sem sinal há N min" só com mensagem
 *    do escritório esperando e 10 min ou mais sem contato;
 *  - a OS que quem vê não pode abrir não aparece; uma linha; cor só no ponto e na pausa por impedimento; sem "você".
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  aguardandoTecnico, dentroDaJornada, LEGENDA_SITUACAO, ONLINE_MS, osDaSituacao, presencaDoTecnico, SEM_SINAL_MIN, situacaoDoTecnico, textoDaSituacao,
  type EntradaSituacao, type EstadoTecnico,
} from "@/lib/chat/presenca";
import { instanteBR } from "@/lib/fuso";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Quinta-feira, 12/11/2026, 10:30 em Brasília
const QUINTA_1030 = instanteBR(2026, 10, 12, 10, 30);
const SEG_SEX_8_17 = { jornadaFaixas: [{ dias: ["SEG", "TER", "QUA", "QUI", "SEX"], entrada: "08:00", saida: "17:00", intervaloInicio: "12:00", intervaloFim: "13:00" }] };
const os = (n: string, id: string | null = `id-${n}`) => ({ id, numero: n });
const entrada = (e: Partial<EntradaSituacao> = {}): EntradaSituacao => ({ emAndamento: [], aCaminho: [], jornada: SEG_SEX_8_17, ...e });
const min = (m: number) => new Date(QUINTA_1030.getTime() - m * 60_000);

describe("a situação e a prioridade", () => {
  it("pausada (com o motivo) quando a atividade em andamento está com a pausa aberta", () => {
    const s = situacaoDoTecnico(entrada({ emAndamento: [{ os: os("OS-4442"), iniciadaEm: min(90), pausa: { motivo: "Falta de peça/material", impedimento: true, inicio: min(10) } }] }), QUINTA_1030);
    expect(s).toEqual({ tipo: "PAUSADA", motivo: "Falta de peça/material", impedimento: true, os: os("OS-4442") });
    expect(textoDaSituacao(s)).toBe("Pausada — Falta de peça/material");
  });

  it("em execução vence a pausa de OUTRA atividade (a esquecida não esconde o serviço de agora); a iniciada por último", () => {
    const s = situacaoDoTecnico(entrada({ emAndamento: [
      { os: os("OS-1"), iniciadaEm: min(600), pausa: { motivo: "Almoço/intervalo", impedimento: false, inicio: min(500) } },
      { os: os("OS-2"), iniciadaEm: min(60), pausa: null },
      { os: os("OS-3"), iniciadaEm: min(20), pausa: null },
    ], aCaminho: [{ os: os("OS-9"), em: min(5) }] }), QUINTA_1030);
    expect(s).toEqual({ tipo: "EM_EXECUCAO", os: os("OS-3") });
    expect(textoDaSituacao(s)).toBe("Em execução");
  });

  it("duas pausadas: a pausa mais recente", () => {
    const s = situacaoDoTecnico(entrada({ emAndamento: [
      { os: os("OS-1"), iniciadaEm: min(300), pausa: { motivo: "Cliente ausente", impedimento: true, inicio: min(200) } },
      { os: os("OS-2"), iniciadaEm: min(100), pausa: { motivo: "Almoço/intervalo", impedimento: false, inicio: min(30) } },
    ] }), QUINTA_1030);
    expect(s).toMatchObject({ tipo: "PAUSADA", motivo: "Almoço/intervalo", impedimento: false });
  });

  it("pausada vence a caminho; a caminho vence fora do expediente; fora do expediente vence sem atividade", () => {
    const pausada = { os: os("OS-1"), iniciadaEm: min(60), pausa: { motivo: "Acesso negado", impedimento: true, inicio: min(5) } };
    expect(situacaoDoTecnico(entrada({ emAndamento: [pausada], aCaminho: [{ os: os("OS-2"), em: min(1) }] }), QUINTA_1030).tipo).toBe("PAUSADA");
    const noite = instanteBR(2026, 10, 12, 21, 0);
    expect(situacaoDoTecnico(entrada({ aCaminho: [{ os: os("OS-2"), em: min(1) }] }), noite)).toEqual({ tipo: "A_CAMINHO", os: os("OS-2") });
    expect(situacaoDoTecnico(entrada(), noite)).toEqual({ tipo: "FORA_DO_EXPEDIENTE" });
    expect(situacaoDoTecnico(entrada(), QUINTA_1030)).toEqual({ tipo: "SEM_ATIVIDADE" });
    expect(textoDaSituacao({ tipo: "FORA_DO_EXPEDIENTE" })).toBe("Fora do expediente");
    expect(textoDaSituacao({ tipo: "SEM_ATIVIDADE" })).toBe("Sem atividade agora");
    expect(textoDaSituacao({ tipo: "A_CAMINHO", os: null })).toBe("A caminho");
  });

  it("a OS que quem vê não pode abrir (Ver só os próprios) não aparece na linha", () => {
    expect(osDaSituacao({ tipo: "EM_EXECUCAO", os: os("OS-7", null) })).toBeNull();
    expect(osDaSituacao({ tipo: "EM_EXECUCAO", os: os("OS-7") })).toEqual(os("OS-7"));
    expect(osDaSituacao({ tipo: "SEM_ATIVIDADE" })).toBeNull();
  });
});

describe("a jornada (Fora do expediente)", () => {
  const faixas = SEG_SEX_8_17.jornadaFaixas as any;
  it("dentro, fora, o intervalo do almoço conta como dentro, fim de semana é fora", () => {
    expect(dentroDaJornada(faixas, QUINTA_1030)).toBe(true);
    expect(dentroDaJornada(faixas, instanteBR(2026, 10, 12, 12, 30))).toBe(true); // almoço
    expect(dentroDaJornada(faixas, instanteBR(2026, 10, 12, 7, 59))).toBe(false);
    expect(dentroDaJornada(faixas, instanteBR(2026, 10, 12, 17, 0))).toBe(false); // a saída já é fora
    expect(dentroDaJornada(faixas, instanteBR(2026, 10, 14, 10, 0))).toBe(false); // sábado
  });
  it("sem jornada no cadastro: não dá para dizer (nunca \"fora\"); o horário antigo (entrada/saída/dias) também vale", () => {
    expect(dentroDaJornada([], QUINTA_1030)).toBeNull();
    expect(situacaoDoTecnico(entrada({ jornada: {} }), instanteBR(2026, 10, 12, 23, 0))).toEqual({ tipo: "SEM_ATIVIDADE" });
    const antiga = { jornadaEntrada: "07:00", jornadaSaida: "16:00", jornadaDias: ["SEG", "QUI"] };
    expect(situacaoDoTecnico(entrada({ jornada: antiga }), instanteBR(2026, 10, 12, 16, 30))).toEqual({ tipo: "FORA_DO_EXPEDIENTE" });
    expect(situacaoDoTecnico(entrada({ jornada: antiga }), instanteBR(2026, 10, 12, 15, 30))).toEqual({ tipo: "SEM_ATIVIDADE" });
  });
  it("faixa que passa da meia-noite (22:00–06:00)", () => {
    const noturna = [{ dias: ["QUI"], entrada: "22:00", saida: "06:00", intervaloInicio: null, intervaloFim: null }] as any;
    expect(dentroDaJornada(noturna, instanteBR(2026, 10, 12, 23, 0))).toBe(true);
    expect(dentroDaJornada(noturna, instanteBR(2026, 10, 12, 21, 0))).toBe(false);
  });
});

describe("a presença", () => {
  it("ponto verde até 2 min do último contato; depois, \"visto por último às HH:MM\" (hoje)", () => {
    expect(presencaDoTecnico(new Date(QUINTA_1030.getTime() - ONLINE_MS), QUINTA_1030, false)).toEqual({ tipo: "ONLINE", texto: "No app agora" });
    expect(presencaDoTecnico(new Date(QUINTA_1030.getTime() - ONLINE_MS - 1000), QUINTA_1030, false)).toEqual({ tipo: "VISTO", texto: "visto por último às 10:27" });
  });
  it("ontem e data; nunca entrou: nada", () => {
    expect(presencaDoTecnico(instanteBR(2026, 10, 11, 18, 5), QUINTA_1030, false)).toEqual({ tipo: "VISTO", texto: "visto por último ontem" });
    expect(presencaDoTecnico(instanteBR(2026, 10, 3, 9, 0), QUINTA_1030, false)).toEqual({ tipo: "VISTO", texto: "visto por último em 03/11" });
    expect(presencaDoTecnico(null, QUINTA_1030, true)).toBeNull();
  });
  it("\"Sem sinal há N min\": só com mensagem do escritório esperando e a partir de 10 min sem contato (até 24 h)", () => {
    expect(presencaDoTecnico(min(SEM_SINAL_MIN), QUINTA_1030, true)).toEqual({ tipo: "SEM_SINAL", texto: "Sem sinal há 10 min" });
    expect(presencaDoTecnico(min(SEM_SINAL_MIN - 1), QUINTA_1030, true)).toEqual({ tipo: "VISTO", texto: "visto por último às 10:21" });
    expect(presencaDoTecnico(min(SEM_SINAL_MIN), QUINTA_1030, false)?.tipo).toBe("VISTO"); // nada esperando: só "visto"
    expect(presencaDoTecnico(min(130), QUINTA_1030, true)).toEqual({ tipo: "SEM_SINAL", texto: "Sem sinal há 2 h" });
    expect(presencaDoTecnico(min(1), QUINTA_1030, true)?.tipo).toBe("ONLINE");
    expect(presencaDoTecnico(min(60 * 25), QUINTA_1030, true)?.tipo).toBe("VISTO");
  });
  it("esperando = a última da conversa é do escritório e ele ainda não leu", () => {
    expect(aguardandoTecnico({ origem: "ESCRITORIO", lida: false })).toBe(true);
    expect(aguardandoTecnico({ origem: "ESCRITORIO", lida: true })).toBe(false);
    expect(aguardandoTecnico({ origem: "APP", lida: false })).toBe(false);
    expect(aguardandoTecnico(null)).toBe(false);
  });
  it("a legenda do ⓘ: sem \"você\"", () => {
    expect(LEGENDA_SITUACAO).not.toMatch(/\bvocê\b/i);
    expect(LEGENDA_SITUACAO).toContain("2 minutos");
  });
});

/* ───────── a linha na tela ───────── */
let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
async function montar(el: React.ReactElement) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(el); });
}
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const estado = (situacao: EstadoTecnico["situacao"], contatoEm: Date | null): EstadoTecnico => ({ usuarioId: "uT", situacao, contatoEm: contatoEm?.toISOString() ?? null });

describe("a linha e o ponto", () => {
  it("em execução com a OS clicável (cabeçalho) e \"visto por último\"; na lista o número é texto (a linha já é o botão)", async () => {
    const { LinhaSituacao } = await import("@/components/chat/situacao-tecnico");
    const e = estado({ tipo: "EM_EXECUCAO", os: os("OS-4442", "os42") }, min(15));
    await montar(createElement("div", null,
      createElement("div", { id: "cab" }, createElement(LinhaSituacao, { estado: e, agora: QUINTA_1030, aguardando: false, linkOs: true })),
      createElement("div", { id: "lista" }, createElement(LinhaSituacao, { estado: e, agora: QUINTA_1030, aguardando: false }))));
    expect(txt($("#cab [data-situacao]"))).toBe("Em execução · OS-4442 · visto por último às 10:15");
    expect($("#cab a[data-situacao-os]")!.getAttribute("href")).toBe("/ordens/os42");
    expect($("#lista a")).toBeNull();
    expect(txt($("#lista [data-situacao-os]"))).toBe("OS-4442");
  });

  it("no app agora: o ponto verde (nome acessível) e nenhum texto de presença; a OS invisível não aparece", async () => {
    const { LinhaSituacao, PontoPresenca } = await import("@/components/chat/situacao-tecnico");
    const e = estado({ tipo: "A_CAMINHO", os: os("OS-7", null) }, min(1));
    await montar(createElement("div", null, createElement(PontoPresenca, { estado: e, agora: QUINTA_1030 }), createElement(LinhaSituacao, { estado: e, agora: QUINTA_1030, aguardando: true })));
    expect($("[data-ponto-presenca]")!.getAttribute("aria-label")).toBe("No app agora");
    expect(txt($("[data-situacao]"))).toBe("A caminho");
    expect($("[data-presenca]")).toBeNull();
  });

  it("sem sinal com mensagem esperando; cor só na pausa por impedimento (a de almoço, não)", async () => {
    const { LinhaSituacao, PontoPresenca } = await import("@/components/chat/situacao-tecnico");
    const imp = estado({ tipo: "PAUSADA", motivo: "Falta de peça/material", impedimento: true, os: os("OS-1") }, min(25));
    await montar(createElement("div", null, createElement(PontoPresenca, { estado: imp, agora: QUINTA_1030 }), createElement(LinhaSituacao, { estado: imp, agora: QUINTA_1030, aguardando: true })));
    expect($("[data-ponto-presenca]")).toBeNull();
    expect(txt($("[data-situacao]"))).toBe("Pausada — Falta de peça/material · OS-1 · Sem sinal há 25 min");
    expect($("[data-presenca='SEM_SINAL']")!.parentElement!.getAttribute("title")).toBe("A mensagem fica esperando e chega quando o sinal voltar.");
    expect($("[data-situacao-texto]")!.className).toContain("text-atencao-texto");
    act(() => root!.unmount()); root = undefined; document.body.innerHTML = "";
    const almoco = estado({ tipo: "PAUSADA", motivo: "Almoço/intervalo", impedimento: false, os: null }, null);
    await montar(createElement(LinhaSituacao, { estado: almoco, agora: QUINTA_1030, aguardando: false }));
    expect(txt($("[data-situacao]"))).toBe("Pausada — Almoço/intervalo");
    expect($("[data-situacao-texto]")!.className).not.toContain("atencao");
  });
});
