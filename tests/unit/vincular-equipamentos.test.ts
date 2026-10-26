/**
 * Gaveta "Vincular equipamento" da Nova OS — regras puras: rótulo/detalhe, busca (nome, marca,
 * modelo, BTU/TR, TAG, ambiente, local; sem acento/caixa; número sem ponto), filtro por local,
 * contagem por local e "selecionar todos" sobre o que está visível.
 */
import { describe, expect, it } from "vitest";
import {
  alternarTodos, combinaBusca, detalheEquipamento, filtrarEquipamentos, locaisComEquipamento, rotuloEquipamento, type EquipamentoResumo,
} from "@/lib/os/vincular-equipamentos";

const MATRIZ = { id: "un1", nome: "Matriz" };
const ANEXO = { id: "un2", nome: "Anexo — Bloco B" };
const eq = (id: string, extra: Partial<EquipamentoResumo>): EquipamentoResumo => ({ id, marca: "Daikin", modelo: "FTXS", ativo: true, unidade: MATRIZ, unidadeId: "un1", ...extra });

const A = eq("A", { nome: "Split Recepção", capacidade: "12.000 BTU/h", patrimonio: "AC-01", setor: "Térreo", localizacao: "Recepção", tipoEquipamento: { id: "t", nome: "Split Hi-Wall" } });
const B = eq("B", { nome: "Split Sala 10", marca: "LG", modelo: "Dual", capacidade: "18.000 BTU/h", patrimonio: "AC-02" });
const C = eq("C", { nome: "Split Sala 9", marca: "LG", modelo: "Dual" });
const D = eq("D", { nome: "Chiller", marca: "Carrier", modelo: "30RB", potencia: "3 TR", unidade: ANEXO, unidadeId: "un2" });
const INATIVO = eq("X", { nome: "Antigo", ativo: false, unidade: ANEXO, unidadeId: "un2" });

describe("rótulo e detalhe", () => {
  it("rótulo: nome — marca modelo (sem nome, só marca e modelo)", () => {
    expect(rotuloEquipamento(A)).toBe("Split Recepção — Daikin FTXS");
    expect(rotuloEquipamento(eq("Z", { nome: null }))).toBe("Daikin FTXS");
  });
  it("detalhe: tipo · capacidade · ambiente · TAG · local (local só quando pedido)", () => {
    expect(detalheEquipamento(A, true)).toBe("Split Hi-Wall · 12.000 BTU/h · Térreo / Recepção · TAG AC-01 · Matriz");
    expect(detalheEquipamento(A, false)).toBe("Split Hi-Wall · 12.000 BTU/h · Térreo / Recepção · TAG AC-01");
    expect(detalheEquipamento(D, false)).toBe("3 TR");
  });
});

describe("busca", () => {
  it.each([
    ["recepcao", true], ["RECEPÇÃO", true], ["daikin", true], ["ftxs", true], ["ac-01", true], ["térreo", true],
    ["matriz", true], ["hi-wall", true], ["12.000", true], ["12000", true], ["12000 btu", true], ["daikin 12000", true],
    ["18000", false], ["lg", false], ["daikin lg", false], ["120", false],
  ])("“%s” acha o Split Recepção? %s", (busca, esperado) => {
    expect(combinaBusca(A, busca)).toBe(esperado);
  });
  it("TR e local do equipamento", () => {
    expect(combinaBusca(D, "3 tr")).toBe(true);
    expect(combinaBusca(D, "anexo bloco")).toBe(true);
    expect(combinaBusca(D, "bloco z")).toBe(false);
  });
  it("busca vazia acha tudo", () => {
    expect(combinaBusca(A, "  ")).toBe(true);
  });
});

describe("filtro, locais e selecionar todos", () => {
  const lista = [D, B, INATIVO, C, A];
  it("sem filtro: só ativos, por local e nome em ordem natural (Sala 9 antes de Sala 10)", () => {
    expect(filtrarEquipamentos(lista, {}).map((e) => e.id)).toEqual(["D", "A", "C", "B"]);
  });
  it("por local e com busca", () => {
    expect(filtrarEquipamentos(lista, { unidadeId: "un1" }).map((e) => e.id)).toEqual(["A", "C", "B"]);
    expect(filtrarEquipamentos(lista, { unidadeId: "un1", busca: "lg" }).map((e) => e.id)).toEqual(["C", "B"]);
    expect(filtrarEquipamentos(lista, { unidadeId: "un2", busca: "lg" })).toEqual([]);
    // o local vem de unidadeId quando a unidade não veio junto
    expect(filtrarEquipamentos([eq("S", { unidade: null, unidadeId: "un9" })], { unidadeId: "un9" }).map((e) => e.id)).toEqual(["S"]);
  });
  it("locais com a contagem de ativos, em ordem de nome", () => {
    expect(locaisComEquipamento(lista)).toEqual([{ id: "un2", nome: "Anexo — Bloco B", qtd: 1 }, { id: "un1", nome: "Matriz", qtd: 3 }]);
    expect(locaisComEquipamento([])).toEqual([]);
  });
  it("selecionar todos marca os visíveis (mantendo os de fora); se todos já estão marcados, desmarca só eles", () => {
    const fora = new Set(["D"]);
    const marcados = alternarTodos(fora, ["A", "B"]);
    expect([...marcados].sort()).toEqual(["A", "B", "D"]);
    expect([...alternarTodos(marcados, ["A", "B"])]).toEqual(["D"]);
    expect([...alternarTodos(new Set(["A"]), ["A", "B"])].sort()).toEqual(["A", "B"]); // parcial → completa
    expect([...alternarTodos(new Set(["A"]), [])]).toEqual(["A"]);
  });
});
