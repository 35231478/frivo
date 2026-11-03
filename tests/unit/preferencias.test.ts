/**
 * Preferência pessoal de tela (lib/preferencias, pura): o que o navegador manda é validado, o que
 * volta do banco/localStorage é normalizado contra as colunas da tela, e "sem lista de ocultas"
 * é diferente de "lista vazia" (padrões da tela × todas visíveis).
 */
import { describe, expect, it } from "vitest";
import {
  ajustarPreferencia, CHAVE_PREFERENCIA, chaveTabela, LARGURA_MAX, LARGURA_MIN, lerPreferenciaTabela, ocultasEfetivas,
  PREFERENCIA_VAZIA, preferenciaTabelaSchema, preferenciaVazia,
} from "@/lib/preferencias";

const COLUNAS = [
  { id: "codigo", obrigatoria: true },
  { id: "nome", obrigatoria: true, minimo: 120 },
  { id: "cliente" },
  { id: "tipo", oculta: true },
  { id: "valor", obrigatoria: true },
];

describe("chave", () => {
  it("só 'tabela:<tela>' em minúsculas, dígitos e hífen (nada de barra, ponto ou espaço: a chave vai na URL e no banco)", () => {
    expect(chaveTabela("orcamentos")).toBe("tabela:orcamentos");
    for (const ok of ["tabela:orcamentos", "tabela:cadastro-produtos", "tabela:contas-receber", "tabela:x1"]) expect(CHAVE_PREFERENCIA.test(ok)).toBe(true);
    for (const ruim of ["orcamentos", "tabela:", "tabela:Orcamentos", "tabela:a/b", "tabela:a b", "tabela:a.b", "painel:x", `tabela:${"a".repeat(61)}`]) expect(CHAVE_PREFERENCIA.test(ruim)).toBe(false);
  });
});

describe("validação do que o navegador manda", () => {
  it("aceita larguras inteiras dentro da faixa e a lista de ocultas (opcional); recusa o resto", () => {
    expect(preferenciaTabelaSchema.safeParse({ larguras: { nome: 200 }, ocultas: ["tipo"] }).success).toBe(true);
    expect(preferenciaTabelaSchema.safeParse({ larguras: {} }).success).toBe(true);
    expect(preferenciaTabelaSchema.safeParse({ larguras: { nome: LARGURA_MIN - 1 } }).success).toBe(false);
    expect(preferenciaTabelaSchema.safeParse({ larguras: { nome: LARGURA_MAX + 1 } }).success).toBe(false);
    expect(preferenciaTabelaSchema.safeParse({ larguras: { nome: 200.5 } }).success).toBe(false);
    expect(preferenciaTabelaSchema.safeParse({ larguras: { nome: "200" } }).success).toBe(false);
    expect(preferenciaTabelaSchema.safeParse({ larguras: {}, ocultas: "tipo" }).success).toBe(false);
    expect(preferenciaTabelaSchema.safeParse({ larguras: {}, outra: 1 }).success).toBe(false); // strict
    expect(preferenciaTabelaSchema.safeParse({ ocultas: [] }).success).toBe(false); // larguras é obrigatório
    expect(preferenciaTabelaSchema.safeParse(null).success).toBe(false);
  });
  it("colunas demais (80+) é recusado: ninguém tem uma tabela dessas", () => {
    const larguras = Object.fromEntries(Array.from({ length: 81 }, (_, i) => [`c${i}`, 100]));
    expect(preferenciaTabelaSchema.safeParse({ larguras }).success).toBe(false);
    expect(preferenciaTabelaSchema.safeParse({ larguras: {}, ocultas: Array.from({ length: 81 }, (_, i) => `c${i}`) }).success).toBe(false);
  });
  it("lerPreferenciaTabela: JSON torto vira 'sem preferência', nunca estoura", () => {
    expect(lerPreferenciaTabela(null)).toEqual(PREFERENCIA_VAZIA);
    expect(lerPreferenciaTabela("x")).toEqual(PREFERENCIA_VAZIA);
    expect(lerPreferenciaTabela({ larguras: { a: -1 } })).toEqual(PREFERENCIA_VAZIA);
    expect(lerPreferenciaTabela({ larguras: { a: 100 }, ocultas: ["b"] })).toEqual({ larguras: { a: 100 }, ocultas: ["b"] });
  });
});

describe("ajustarPreferencia (casa a preferência com as colunas da tela)", () => {
  it("descarta coluna que não existe mais, respeita a mínima de cada coluna e nunca esconde obrigatória", () => {
    const p = ajustarPreferencia({ larguras: { nome: 50, cliente: 300.4, sumiu: 100 }, ocultas: ["tipo", "codigo", "sumiu", "tipo"] }, COLUNAS);
    expect(p).toEqual({ larguras: { nome: 120, cliente: 300 }, ocultas: ["tipo"] });
  });
  it("largura acima do teto é trazida para o teto", () => {
    expect(ajustarPreferencia({ larguras: { cliente: 99999 } }, COLUNAS).larguras.cliente).toBe(LARGURA_MAX);
  });
  it("devolve o MESMO objeto quando nada muda (não dispara re-render à toa) e preserva 'ocultas ausente'", () => {
    const p = { larguras: { nome: 200 }, ocultas: ["tipo"] };
    expect(ajustarPreferencia(p, COLUNAS)).toBe(p);
    const semOcultas = { larguras: { nome: 200 } };
    expect(ajustarPreferencia(semOcultas, COLUNAS)).toBe(semOcultas);
    expect(ajustarPreferencia({ larguras: { sumiu: 100 } }, COLUNAS)).toEqual({ larguras: {} });
  });
});

describe("ocultas efetivas e 'vazia'", () => {
  it("sem lista guardada valem as escondidas por padrão da tela; lista vazia = todas visíveis", () => {
    expect([...ocultasEfetivas({ larguras: {} }, COLUNAS)]).toEqual(["tipo"]);
    expect([...ocultasEfetivas({ larguras: {}, ocultas: [] }, COLUNAS)]).toEqual([]);
    expect([...ocultasEfetivas({ larguras: {}, ocultas: ["cliente"] }, COLUNAS)]).toEqual(["cliente"]);
  });
  it("preferenciaVazia: só sem larguras E sem lista de ocultas", () => {
    expect(preferenciaVazia({ larguras: {} })).toBe(true);
    expect(preferenciaVazia({ larguras: {}, ocultas: [] })).toBe(false);
    expect(preferenciaVazia({ larguras: { a: 100 } })).toBe(false);
  });
});
