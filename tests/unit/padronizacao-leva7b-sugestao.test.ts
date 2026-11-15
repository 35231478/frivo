/**
 * Leva 7B — a sugestão do pedido de compra: REGRAS PURAS.
 *
 * A regra da casa é a mesma das outras sugestões (OS na leva 5, item do orçamento na 6B), com uma
 * distinção que vale de propósito:
 *  - QUAIS produtos vêm é fato do estoque (saldo ≤ mínimo, ou negativo): entra até sem histórico;
 *  - FORNECEDOR e PREÇO vêm do histórico e só com histórico de verdade — janela de 6 meses, no
 *    mínimo 2 compras distintas — e o preço é o da compra MAIS RECENTE, nunca a média.
 * Com histórico fino, o produto aparece sem palpite de preço ("compra nova"), que é o jeito honesto:
 * o estoque em falta é um fato, o preço de uma única compra antiga não é.
 */
import { describe, expect, it } from "vitest";
import {
  JANELA_MESES, MINIMO_COMPRAS, faltaParaOMinimo, inicioDaJanela, motivoDoPreco, sugestoesDeCompra,
  type CompraDoHistorico, type ProdutoEmFalta,
} from "@/lib/compras/sugestao-compra";

const HOJE = new Date("2026-11-15T12:00:00Z");
const diasAtras = (d: number) => new Date(HOJE.getTime() - d * 86_400_000);

const produto = (id: string, saldo: number, minimo: number, nome = `Produto ${id}`): ProdutoEmFalta =>
  ({ produtoId: id, nome, unidade: "un", saldo, estoqueMinimo: minimo });
const compra = (produtoId: string, compraId: string, valor: number, dias: number, fornecedor = "Frigelar"): CompraDoHistorico =>
  ({ produtoId, compraId, fornecedor, valorUnitario: valor, data: diasAtras(dias) });

describe("a regra da casa", () => {
  it("janela de 6 meses e mínimo de 2 compras (igual às outras sugestões)", () => {
    expect([JANELA_MESES, MINIMO_COMPRAS]).toEqual([6, 2]);
    expect(inicioDaJanela(HOJE).toISOString().slice(0, 10)).toBe("2026-05-15");
  });

  it("com 2 compras na janela, traz o último fornecedor e o ÚLTIMO preço (não a média)", () => {
    const [s] = sugestoesDeCompra([produto("p1", 1, 4)], [
      compra("p1", "nf1", 100, 150, "Frigelar"),
      compra("p1", "nf2", 130, 10, "Refrimais"),
    ]);
    expect(s.valorUnitario).toBe(130); // a média seria 115 — e não é isso que se paga
    expect(s.fornecedor).toBe("Refrimais");
    expect(s.vezes).toBe(2);
    expect(motivoDoPreco(s)).toBe("2 compras nos últimos 6 meses");
  });

  it("histórico fino (uma compra só): o produto aparece, o preço NÃO", () => {
    const [s] = sugestoesDeCompra([produto("p1", 1, 4)], [compra("p1", "nf1", 100, 10)]);
    expect(s.produtoId).toBe("p1");
    expect([s.valorUnitario, s.fornecedor]).toEqual([null, null]);
    expect(s.vezes).toBe(1);
  });

  it("sem nenhuma compra: também aparece sem preço (o estoque em falta é fato)", () => {
    const [s] = sugestoesDeCompra([produto("p1", 0, 4)], []);
    expect([s.valorUnitario, s.fornecedor, s.vezes]).toEqual([null, null, 0]);
  });

  it("duas linhas da MESMA nota são uma compra só (não viram histórico)", () => {
    const [s] = sugestoesDeCompra([produto("p1", 1, 4)], [
      compra("p1", "nf1", 100, 20),
      compra("p1", "nf1", 110, 20),
    ]);
    expect(s.vezes).toBe(1);
    expect(s.valorUnitario).toBeNull();
  });

  it("preço zerado ou negativo não conta como compra", () => {
    const [s] = sugestoesDeCompra([produto("p1", 1, 4)], [
      compra("p1", "nf1", 0, 20),
      compra("p1", "nf2", 120, 10),
    ]);
    expect([s.vezes, s.valorUnitario]).toEqual([1, null]);
  });

  it("o fornecedor da última compra pode vir vazio, e aí é só o preço", () => {
    const [s] = sugestoesDeCompra([produto("p1", 1, 4)], [
      compra("p1", "nf1", 100, 100, "Frigelar"),
      { ...compra("p1", "nf2", 120, 5), fornecedor: null },
    ]);
    expect([s.fornecedor, s.valorUnitario]).toEqual([null, 120]);
  });
});

describe("quanto falta e em que ordem", () => {
  it("falta = mínimo − saldo; saldo negativo cobra a dívida inteira", () => {
    expect(faltaParaOMinimo({ saldo: 1, estoqueMinimo: 4 })).toBe(3);
    expect(faltaParaOMinimo({ saldo: -2, estoqueMinimo: 4 })).toBe(6);
    expect(faltaParaOMinimo({ saldo: 2.5, estoqueMinimo: 4 })).toBe(1.5);
    // no mínimo exato ainda é hora de comprar (a situação do estoque já diz "abaixo")
    expect(faltaParaOMinimo({ saldo: 4, estoqueMinimo: 4 })).toBe(0);
    expect(faltaParaOMinimo({ saldo: 9, estoqueMinimo: 4 })).toBe(0);
  });

  it("o mais crítico primeiro: negativo, depois quem falta mais, depois pelo nome", () => {
    const r = sugestoesDeCompra([
      produto("pA", 3, 4, "Filtro G4"),
      produto("pB", -2, 4, "Gás R410A"),
      produto("pC", 1, 10, "Tubo de cobre"),
      produto("pD", 3, 4, "Capacitor 35uF"),
    ], []);
    expect(r.map((s) => s.produtoId)).toEqual(["pB", "pC", "pD", "pA"]);
    expect(r.map((s) => s.faltam)).toEqual([6, 9, 1, 1]);
  });

  it("a faixa não vira lista infinita (teto de sugestões)", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => produto(`p${i}`, 0, 1));
    expect(sugestoesDeCompra(muitos, [])).toHaveLength(6);
    expect(sugestoesDeCompra(muitos, [], { maximo: 3 })).toHaveLength(3);
  });

  it("nada em falta, nada a sugerir (a tela não mostra faixa)", () => {
    expect(sugestoesDeCompra([], [compra("p1", "nf1", 100, 1)])).toEqual([]);
  });

  it("compra de OUTRO produto não empresta histórico", () => {
    const [s] = sugestoesDeCompra([produto("p1", 0, 4)], [
      compra("p2", "nf1", 100, 10),
      compra("p2", "nf2", 120, 5),
    ]);
    expect([s.vezes, s.valorUnitario]).toEqual([0, null]);
  });
});
