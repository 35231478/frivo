/**
 * D1 — PAUSAR / IMPEDIMENTO: as regras puras (lib/pausas/regras) e o que a tela do aparelho mostra antes de
 * sincronizar (lib/tecnico/offline/estado › aplicar).
 */
import { describe, expect, it } from "vitest";
import {
  MOTIVOS_PADRAO, duracaoCurta, pausaAberta, pausaDoCartao, podeEncerrarNaoConcluida, problemaDaPausa, resumoTempo,
  tempoDeExecucaoMs, tempoPausadoMs, textoNaoConcluida, textoPausada,
} from "@/lib/pausas/regras";
import { aplicar } from "@/lib/tecnico/offline/estado";
import { operacaoSchema } from "@/lib/tecnico/sync";

const T0 = Date.parse("2027-01-10T12:00:00.000Z");
const t = (min: number) => new Date(T0 + min * 60_000);

describe("motivos padrão", () => {
  it("7 motivos, na ordem; almoço é intervalo; 'Outro' pede texto; o resto é impedimento", () => {
    expect(MOTIVOS_PADRAO.map((m) => m.nome)).toEqual(["Falta de peça/material", "Cliente ausente", "Acesso negado", "Aguardando aprovação do cliente", "Chuva/condição do local", "Almoço/intervalo", "Outro"]);
    expect(MOTIVOS_PADRAO.filter((m) => m.tipo === "INTERVALO").map((m) => m.nome)).toEqual(["Almoço/intervalo"]);
    expect(MOTIVOS_PADRAO.filter((m) => m.pedeTexto).map((m) => m.nome)).toEqual(["Outro"]);
    expect(MOTIVOS_PADRAO.map((m) => m.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("o que falta para pausar: o motivo; no 'Outro', o texto (3 letras)", () => {
    expect(problemaDaPausa(null, "x")).toBe("Escolha o motivo da pausa.");
    expect(problemaDaPausa({ pedeTexto: false }, "")).toBeNull();
    expect(problemaDaPausa({ pedeTexto: true }, " ab ")).toBe("Escreva o motivo (pelo menos 3 letras).");
    expect(problemaDaPausa({ pedeTexto: true }, "abc")).toBeNull();
    expect(problemaDaPausa({ pedeTexto: true }, null)).toBe("Escreva o motivo (pelo menos 3 letras).");
  });
});

describe("tempo de execução sem as pausas", () => {
  it("desconta as pausas dentro do período; a aberta vai até o fim; sobreposição conta uma vez; fora do período não conta", () => {
    expect(tempoPausadoMs(t(0), t(120), [])).toBe(0);
    expect(tempoPausadoMs(t(0), t(120), [{ inicio: t(30), fim: t(60) }])).toBe(30 * 60_000);
    expect(tempoPausadoMs(t(0), t(120), [{ inicio: t(100), fim: null }])).toBe(20 * 60_000); // aberta: até o fim
    expect(tempoPausadoMs(t(0), t(120), [{ inicio: t(30), fim: t(60) }, { inicio: t(45), fim: t(75) }])).toBe(45 * 60_000); // sobrepostas
    expect(tempoPausadoMs(t(0), t(120), [{ inicio: t(-30), fim: t(10) }, { inicio: t(110), fim: t(200) }])).toBe(20 * 60_000); // cortadas nas bordas
    expect(tempoPausadoMs(t(0), t(120), [{ inicio: t(-60), fim: t(-10) }])).toBe(0);
    expect(tempoPausadoMs(t(0), t(120), [{ inicio: t(10), fim: t(20) }, { inicio: t(50), fim: t(70) }])).toBe(30 * 60_000); // separadas
    expect(tempoPausadoMs(t(120), t(0), [{ inicio: t(30), fim: t(60) }])).toBe(0); // período invertido
    expect(tempoPausadoMs(t(0), t(120), [{ inicio: t(30), fim: t(30) }])).toBe(0); // pausa de 0 min
    expect(tempoPausadoMs(t(0).toISOString(), t(120).toISOString(), [{ inicio: t(30).toISOString(), fim: t(60).toISOString() }])).toBe(30 * 60_000);
  });

  it("execução = total − pausado; nunca negativa", () => {
    expect(tempoDeExecucaoMs(t(0), t(120), [{ inicio: t(30), fim: t(60) }])).toBe(90 * 60_000);
    expect(tempoDeExecucaoMs(t(0), t(120), [])).toBe(120 * 60_000);
    expect(tempoDeExecucaoMs(t(120), t(0), [])).toBe(0);
    expect(tempoDeExecucaoMs(t(0), t(0), [])).toBe(0);
    expect(resumoTempo(t(0), t(120), [{ inicio: t(30), fim: t(75) }])).toBe("Execução 1 h 15 min · pausas 45 min");
    expect(resumoTempo(t(0), t(60), [])).toBe("Execução 1 h");
  });

  it("duração curta: min, h, h min, dias", () => {
    expect(duracaoCurta(0)).toBe("0 min");
    expect(duracaoCurta(59 * 60_000 + 59_000)).toBe("59 min");
    expect(duracaoCurta(60 * 60_000)).toBe("1 h");
    expect(duracaoCurta(130 * 60_000)).toBe("2 h 10 min");
    expect(duracaoCurta(23 * 3_600_000 + 59 * 60_000)).toBe("23 h 59 min");
    expect(duracaoCurta(24 * 3_600_000)).toBe("1 dia");
    expect(duracaoCurta(50 * 3_600_000)).toBe("2 dias");
    expect(duracaoCurta(-5)).toBe("0 min");
  });
});

describe("o que o escritório e o técnico leem", () => {
  it("'Pausada — motivo — há X'", () => {
    expect(textoPausada({ motivo: "Falta de peça/material", inicio: t(0) }, t(125))).toBe("Pausada — Falta de peça/material — há 2 h 5 min");
    expect(textoPausada({ motivo: "Almoço/intervalo", inicio: t(0).toISOString() }, t(12).toISOString())).toBe("Pausada — Almoço/intervalo — há 12 min");
  });
  it("a pausa aberta: a mais recente sem fim", () => {
    expect(pausaAberta([])).toBeNull();
    expect(pausaAberta([{ inicio: t(0), fim: t(10) }])).toBeNull();
    const a = { inicio: t(20), fim: null }, b = { inicio: t(40), fim: null };
    expect(pausaAberta([{ inicio: t(0), fim: t(10) }, a])).toBe(a);
    expect(pausaAberta([b, a])).toBe(b);
  });
  it("encerrar como não concluída: só com uma pausa aberta de impedimento; o texto leva motivo e observação", () => {
    expect(podeEncerrarNaoConcluida(null)).toBe(false);
    expect(podeEncerrarNaoConcluida({ fim: null, impedimento: true })).toBe(true);
    expect(podeEncerrarNaoConcluida({ fim: null, impedimento: false })).toBe(false);
    expect(podeEncerrarNaoConcluida({ fim: t(1), impedimento: true })).toBe(false);
    expect(textoNaoConcluida("Cliente ausente")).toBe("Não concluída — precisa voltar: Cliente ausente");
    expect(textoNaoConcluida("Cliente ausente", "  portaria fechada ")).toBe("Não concluída — precisa voltar: Cliente ausente (portaria fechada)");
    expect(textoNaoConcluida("Cliente ausente", "  ")).toBe("Não concluída — precisa voltar: Cliente ausente");
  });
});

describe("Meu dia: a pausa do servidor corrigida pela fila do aparelho", () => {
  const op = (tipo: string, dados: Record<string, unknown>, atividadeId = "a1", em = t(5).toISOString()) => ({ tipo, atividadeId, em, criadoEm: em, dados });
  it("pausou sem sinal → aparece; retomou → some; outra atividade não mexe; concluir tira a pausa", () => {
    expect(pausaDoCartao("a1", null, [])).toBeNull();
    const p = pausaDoCartao("a1", null, [op("pausar", { clientId: "c1", motivo: "Cliente ausente", impedimento: true })]);
    expect(p).toEqual({ clientId: "c1", motivo: "Cliente ausente", inicio: t(5).toISOString(), impedimento: true });
    expect(pausaDoCartao("a1", null, [op("pausar", { clientId: "c1", motivo: "x", impedimento: true }), op("retomar", { pausaClientId: "c1" })])).toBeNull();
    const srv = { clientId: "s1", motivo: "Almoço/intervalo", inicio: t(0).toISOString(), impedimento: false };
    expect(pausaDoCartao("a1", srv, [])).toBe(srv);
    expect(pausaDoCartao("a1", srv, [op("retomar", { pausaClientId: "s1" })])).toBeNull();
    expect(pausaDoCartao("a1", srv, [op("retomar", { pausaClientId: "outra" })])).toBe(srv);
    expect(pausaDoCartao("a1", srv, [op("retomar", { pausaClientId: "s1" }, "a2")])).toBe(srv);
    expect(pausaDoCartao("a1", srv, [op("naoConcluida", { pausaClientId: "s1" })])).toBeNull();
    expect(pausaDoCartao("a1", srv, [op("concluir", {})])).toBeNull();
    // já pausada: outro "pausar" não troca a pausa
    expect(pausaDoCartao("a1", srv, [op("pausar", { clientId: "c2", motivo: "Outro", impedimento: true })])).toBe(srv);
    expect(pausaDoCartao("a1", undefined, [op("pausar", { clientId: "c3", motivo: "Outro", impedimento: false })])?.impedimento).toBe(false);
  });
});

describe("a tela do aparelho antes de sincronizar (aplicar)", () => {
  const x = (status = "EM_ANDAMENTO", extra: Record<string, unknown> = {}) => ({ atividade: { id: "a1", titulo: "t", status, tipoOs: null }, bloqueada: false, equipamentos: [], adicionais: [], ...extra }) as any;
  const fila = (tipo: string, dados: Record<string, unknown>) => ({ tipo, atividadeId: "a1", em: t(3).toISOString(), criadoEm: t(4).toISOString(), dados, estado: "pendente" }) as any;
  const r = {} as any;
  it("pausar vale já (pendente), só em andamento e sem outra pausa; retomar e encerrar desfazem", () => {
    const p = aplicar(r, x(), fila("pausar", { clientId: "c1", motivo: "Cliente ausente", impedimento: true, observacao: "portão" }));
    expect(p.pausa).toEqual({ clientId: "c1", motivo: "Cliente ausente", impedimento: true, inicio: t(3).toISOString(), observacao: "portão", pendente: true });
    expect(aplicar(r, x("AGENDADA"), fila("pausar", { clientId: "c1", motivo: "x", impedimento: true })).pausa).toBeUndefined();
    expect(aplicar(r, p, fila("pausar", { clientId: "c2", motivo: "y", impedimento: false })).pausa?.clientId).toBe("c1");
    expect(aplicar(r, p, fila("retomar", { pausaClientId: "c1" })).pausa).toBeNull();
    expect(aplicar(r, p, fila("retomar", { pausaClientId: "outra" })).pausa?.clientId).toBe("c1");
    const nc = aplicar(r, p, fila("naoConcluida", { pausaClientId: "c1" }));
    expect(nc).toMatchObject({ pausa: null, bloqueada: true, atividade: { status: "AGENDADA" }, naoConcluida: { motivo: "Cliente ausente", em: t(3).toISOString() } });
    expect(aplicar(r, p, fila("naoConcluida", { pausaClientId: "outra" }))).toBe(p);
    expect(aplicar(r, p, fila("concluir", {})).pausa).toBeNull();
  });

  it("as operações novas passam no schema do sync (e as erradas não)", () => {
    const base = { id: "3f1b5d1e-1c1a-4d2a-9a51-6b8f4c2f9a10", atividadeId: "a1" };
    expect(operacaoSchema.safeParse({ ...base, tipo: "pausar", dados: { clientId: "abcdefgh", motivoId: null, motivo: "Outro", impedimento: true, observacao: "x" } }).success).toBe(true);
    expect(operacaoSchema.safeParse({ ...base, tipo: "pausar", dados: { clientId: "abcdefgh", motivoId: null, motivo: "", impedimento: true } }).success).toBe(false);
    expect(operacaoSchema.safeParse({ ...base, tipo: "pausar", dados: { clientId: "abcdefgh", motivoId: null, motivo: "x", impedimento: true, extra: 1 } }).success).toBe(false);
    expect(operacaoSchema.safeParse({ ...base, tipo: "retomar", dados: { pausaClientId: "abcdefgh" } }).success).toBe(true);
    expect(operacaoSchema.safeParse({ ...base, tipo: "naoConcluida", dados: { pausaClientId: "abcdefgh", observacao: null } }).success).toBe(true);
    expect(operacaoSchema.safeParse({ ...base, tipo: "retomar", dados: {} }).success).toBe(false);
  });
});

describe("push do impedimento", () => {
  it("a mensagem diz o motivo, a OS e quem; só o escritório (com OS) recebe; almoço não manda", async () => {
    const { msgImpedimento, TIPOS_PUSH } = await import("@/lib/push/tipos");
    expect(msgImpedimento({ osNumero: "OS-12", tecnico: "João", motivo: "Falta de peça/material", observacao: "peça amanhã", osId: "os1" }))
      .toEqual({ titulo: "Atividade pausada: Falta de peça/material", corpo: "OS OS-12 · João · peça amanhã", url: "/ordens/os1", tag: "impedimento-os1", acao: "Ver a OS" });
    const def = TIPOS_PUSH.find((d) => d.id === "IMPEDIMENTO")!;
    const { permissoesTotais, PRESETS } = await import("@/lib/permissoes");
    expect(def.podeReceber({ permissoes: permissoesTotais(), role: "ADMIN", restrito: false })).toBe(true);
    expect(def.podeReceber({ permissoes: PRESETS.TECNICO as never, role: "TECNICO", restrito: true })).toBe(false);
    const ev = (await import("node:fs")).readFileSync((await import("node:path")).join(process.cwd(), "lib/push/eventos.ts"), "utf8");
    expect(ev).toContain("if (!p || !p.impedimento) return;");
    expect(ev).toContain("chave: `impedimento:${pausaId}`");
  });
});
