/**
 * Período das listas (lib/periodo.ts) — os atalhos do seletor compacto e as setas ‹ ›:
 * Hoje · Esta semana · Este mês · Este ano · Últimos 30 dias · Últimos 12 meses · Todo o período ·
 * Período personalizado; `ref` na URL só quando navegado; dias de Brasília; padrão por tela.
 */
import { describe, expect, it } from "vitest";
import {
  ATALHOS, diaMais, ehAtual, faixaDiaCivil, hojeBR, inicioSemana, lerPeriodo, mesMais, nomeAtalho, urlDoAtalho, urlVizinho,
} from "@/lib/periodo";

const AGORA = new Date("2026-11-04T01:30:00.000Z"); // terça 03/11/2026 22:30 em Brasília
const iso = (x?: Date | null) => x?.toISOString();
const dias = (p: ReturnType<typeof lerPeriodo>) => [p.dias?.de, p.dias?.ate];

describe("aritmética de dias (sem fuso)", () => {
  it("dia e mês deslocados; fim de mês encurta; segunda-feira da semana", () => {
    expect(diaMais("2026-02-28", 1)).toBe("2026-03-01");
    expect(diaMais("2026-01-01", -1)).toBe("2025-12-31");
    expect(mesMais("2026-01-31", 1)).toBe("2026-02-28");
    expect(mesMais("2026-03-31", -1)).toBe("2026-02-28");
    expect(mesMais("2026-11-03", -12)).toBe("2025-11-03");
    expect(inicioSemana("2026-11-03")).toBe("2026-11-02"); // terça → segunda
    expect(inicioSemana("2026-11-08")).toBe("2026-11-02"); // domingo → a segunda ANTES
    expect(inicioSemana("2026-11-02")).toBe("2026-11-02");
    expect(hojeBR(AGORA)).toBe("2026-11-03"); // 22:30 de Brasília, não 04/11
  });
});

describe("atalhos", () => {
  it("a lista do menu, na ordem", () => {
    expect(ATALHOS.map((a) => a.nome)).toEqual(["Hoje", "Esta semana", "Este mês", "Este ano", "Últimos 30 dias", "Últimos 12 meses", "Todo o período", "Período personalizado"]);
    expect(nomeAtalho("30d")).toBe("Últimos 30 dias");
  });
  it("hoje: o dia de Brasília; navegado traz o dia da semana e vai para a URL", () => {
    const p = lerPeriodo({ periodo: "hoje" }, AGORA);
    expect([p.tipo, p.ref, ...dias(p), p.rotulo]).toEqual(["hoje", null, "2026-11-03", "2026-11-03", "Hoje, 03/11/2026"]);
    expect([iso(p.gte), iso(p.lt)]).toEqual(["2026-11-03T03:00:00.000Z", "2026-11-04T03:00:00.000Z"]);
    const ontem = lerPeriodo({ periodo: "hoje", ref: "2026-11-02" }, AGORA);
    expect([ontem.ref, ontem.rotulo]).toEqual(["2026-11-02", "Segunda-feira, 02/11/2026"]);
    expect(lerPeriodo({ periodo: "hoje", ref: "2026-13-40" }, AGORA).ref).toBeNull(); // ref inválida = hoje
  });
  it("esta semana: segunda a domingo; ref = a segunda", () => {
    const p = lerPeriodo({ periodo: "semana" }, AGORA);
    expect([p.ref, ...dias(p), p.rotulo]).toEqual([null, "2026-11-02", "2026-11-08", "02/11/2026 a 08/11/2026"]);
    const outra = lerPeriodo({ periodo: "semana", ref: "2026-10-29" }, AGORA); // quinta → a semana de 26/10
    expect([outra.ref, ...dias(outra)]).toEqual(["2026-10-26", "2026-10-26", "2026-11-01"]);
  });
  it("este ano, últimos 30 dias (inclusive hoje) e últimos 12 meses", () => {
    expect(dias(lerPeriodo({ periodo: "ano" }, AGORA))).toEqual(["2026-01-01", "2026-12-31"]);
    expect(lerPeriodo({ periodo: "ano", ref: "2024-07-15" }, AGORA)).toMatchObject({ ref: "2024-01-01", rotulo: "2024" });
    const d30 = lerPeriodo({ periodo: "30d" }, AGORA);
    expect([...dias(d30), d30.rotulo]).toEqual(["2026-10-05", "2026-11-03", "05/10/2026 a 03/11/2026"]);
    expect(dias(lerPeriodo({ periodo: "12m" }, AGORA))).toEqual(["2025-11-04", "2026-11-03"]);
  });
  it("este mês continua o padrão (sem nada na URL) e tem os dias inclusivos; o intervalo vence tudo", () => {
    const p = lerPeriodo({}, AGORA);
    expect([p.tipo, p.mes, ...dias(p)]).toEqual(["mes", "2026-11", "2026-11-01", "2026-11-30"]);
    expect(dias(lerPeriodo({ mes: "2026-02" }, AGORA))).toEqual(["2026-02-01", "2026-02-28"]);
    expect(lerPeriodo({ periodo: "ano", de: "2026-11-10" }, AGORA)).toMatchObject({ tipo: "intervalo", de: "2026-11-10", ate: null, dias: { de: "2026-11-10", ate: null } });
  });
  it("padrão da tela: 'todos' onde a lista não é por período (OS, Faturas); atalho desconhecido cai no padrão", () => {
    expect(lerPeriodo({}, AGORA, { padrao: "todos" }).tipo).toBe("todos");
    expect(lerPeriodo({ periodo: "xyz" }, AGORA, { padrao: "todos" }).tipo).toBe("todos");
    expect(lerPeriodo({ mes: "2026-05" }, AGORA, { padrao: "todos" })).toMatchObject({ tipo: "mes", mes: "2026-05" });
    expect(lerPeriodo({ periodo: "todos" }, AGORA, { padrao: "todos" }).tipo).toBe("todos"); // padrão todos já permite
    expect(lerPeriodo({ periodo: "todos" }, AGORA).tipo).toBe("mes"); // sem permitir = mês corrente
  });
  it("faixa de dia civil vale para todo atalho; todos = null", () => {
    const s = faixaDiaCivil(lerPeriodo({ periodo: "semana" }, AGORA))!;
    expect([iso(s.gte), iso(s.lt)]).toEqual(["2026-11-02T00:00:00.000Z", "2026-11-09T00:00:00.000Z"]);
    expect(faixaDiaCivil(lerPeriodo({}, AGORA, { padrao: "todos" }))).toBeNull();
  });
});

describe("setas ‹ › e o menu", () => {
  const url = (sp: Record<string, string>, delta: number, o?: { padrao?: "mes" | "todos"; permitirTodos?: boolean }) => urlVizinho(lerPeriodo(sp, AGORA, o), delta, AGORA);
  const limpo = { mes: null, de: null, ate: null, periodo: null, ref: null };
  it("mês: vizinho; o corrente sai da URL", () => {
    expect(url({}, -1)).toEqual({ ...limpo, mes: "2026-10" });
    expect(url({ mes: "2026-10" }, 1)).toEqual(limpo);
  });
  it("hoje/semana/ano/30d/12m: anda a unidade do atalho; voltar ao de hoje limpa a ref", () => {
    expect(url({ periodo: "hoje" }, -1)).toEqual({ ...limpo, periodo: "hoje", ref: "2026-11-02" });
    expect(url({ periodo: "hoje", ref: "2026-11-02" }, 1)).toEqual({ ...limpo, periodo: "hoje", ref: null });
    expect(url({ periodo: "semana" }, 1)).toEqual({ ...limpo, periodo: "semana", ref: "2026-11-09" });
    expect(url({ periodo: "ano" }, -1)).toEqual({ ...limpo, periodo: "ano", ref: "2025-01-01" });
    expect(url({ periodo: "ano", ref: "2025-01-01" }, 1)).toEqual({ ...limpo, periodo: "ano", ref: null });
    expect(url({ periodo: "30d" }, -1)).toEqual({ ...limpo, periodo: "30d", ref: "2026-10-04" });
    expect(url({ periodo: "12m" }, -1)).toEqual({ ...limpo, periodo: "12m", ref: "2025-11-03" });
  });
  it("intervalo fechado anda o próprio tamanho; aberto e 'todos' não têm setas", () => {
    expect(url({ de: "2026-11-01", ate: "2026-11-10" }, 1)).toEqual({ ...limpo, de: "2026-11-11", ate: "2026-11-20" });
    expect(url({ de: "2026-11-01" }, 1)).toBeNull();
    expect(url({}, 1, { padrao: "todos" })).toBeNull();
  });
  it("ir a um atalho zera o resto; 'este mês' é a URL limpa; ehAtual diz se é o de hoje", () => {
    expect(urlDoAtalho("semana")).toEqual({ ...limpo, periodo: "semana" });
    expect(urlDoAtalho("mes")).toEqual(limpo);
    expect(urlDoAtalho("todos")).toEqual({ ...limpo, periodo: "todos" });
    expect(ehAtual(lerPeriodo({}, AGORA), AGORA)).toBe(true);
    expect(ehAtual(lerPeriodo({ mes: "2026-10" }, AGORA), AGORA)).toBe(false);
    expect(ehAtual(lerPeriodo({ periodo: "hoje" }, AGORA), AGORA)).toBe(true);
    expect(ehAtual(lerPeriodo({ periodo: "hoje", ref: "2026-11-01" }, AGORA), AGORA)).toBe(false);
    expect(ehAtual(lerPeriodo({ de: "2026-11-01" }, AGORA), AGORA)).toBe(false);
  });
});
