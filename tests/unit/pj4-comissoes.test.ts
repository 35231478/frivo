/**
 * PJ4 — varredura das comissões: as regras puras que a leva corrigiu.
 *  - a categoria compara sem acento também na trava de regra repetida (como na hora de casar o item);
 *  - o % da mensalidade do contrato nunca libera mais que o valor congelado (reajuste depois de liberar uma parte).
 */
import { describe, expect, it } from "vitest";
import { chaveDaRegra } from "@/lib/comissoes/regras";
import { alvoDaParte } from "@/lib/comissoes/contrato";

describe("PJ4 — regra repetida", () => {
  const r = (categoria: string) => ({ papel: "VENDEDOR" as const, quemTipo: "CARGO" as const, usuarioId: null, cargoId: "cg", sobreTipo: "CATEGORIA" as const, servicoId: null, categoria });
  it("'Instalação', 'instalacao' e ' INSTALAÇÃO ' são a mesma regra; 'Limpeza' é outra", () => {
    expect(chaveDaRegra(r("Instalação"))).toBe(chaveDaRegra(r("instalacao")));
    expect(chaveDaRegra(r(" INSTALAÇÃO "))).toBe(chaveDaRegra(r("Instalação")));
    expect(chaveDaRegra(r("Limpeza"))).not.toBe(chaveDaRegra(r("Instalação")));
  });
});

describe("PJ4 — o % da mensalidade não passa do valor congelado", () => {
  const base = { base: "PERC_MENSALIDADE" as const, taxa: 10, coberta: true, jaLiberado: 50 };
  it("mensalidade de 1.000 (valor 100) reajustada para 1.200 depois de liberar 50: o alvo para em 100", () => {
    expect(alvoDaParte({ ...base, valor: 100, recebido: 1200, mensalidade: 1200 })).toBe(100);
  });
  it("sem reajuste o alvo é a taxa sobre o que entrou (parcial = proporcional)", () => {
    expect(alvoDaParte({ ...base, valor: 100, recebido: 600, mensalidade: 1000 })).toBe(60);
    expect(alvoDaParte({ ...base, valor: 100, recebido: 1000, mensalidade: 1000 })).toBe(100);
  });
  it("valor desconhecido (0) não trava: vale a taxa", () => {
    expect(alvoDaParte({ ...base, valor: 0, recebido: 500, mensalidade: 500 })).toBe(50);
  });
});

import { liberacaoPorMes } from "@/lib/comissoes/regras";
describe("PJ4 — a liberação por recebimento vai para o mês em que o dinheiro entrou", () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  const entradas = [{ data: d("2026-10-20"), valor: 500 }, { data: d("2026-11-02"), valor: 500 }];
  it("comissão R$ 100 numa venda de R$ 1.000 em 2×500 (20/10 e 02/11), conta feita em 05/11: 50 em outubro, 50 em novembro (antes, 100 em 02/11)", () => {
    expect(liberacaoPorMes({ valorComissao: 100, totalVenda: 1000, jaLiberado: 0, valor: 100, entradas, reserva: d("2026-11-05") }))
      .toEqual([{ data: d("2026-10-20"), valor: 50 }, { data: d("2026-11-02"), valor: 50 }]);
  });
  it("o que já foi liberado consome os meses mais antigos: com 50 liberados, só os 50 de novembro", () => {
    expect(liberacaoPorMes({ valorComissao: 100, totalVenda: 1000, jaLiberado: 50, valor: 50, entradas, reserva: d("2026-11-05") }))
      .toEqual([{ data: d("2026-11-02"), valor: 50 }]);
  });
  it("dois recebimentos no mesmo mês viram um lançamento (na data do último); sem entradas, uma data só", () => {
    const mesmo = [{ data: d("2026-10-05"), valor: 300 }, { data: d("2026-10-25"), valor: 700 }];
    expect(liberacaoPorMes({ valorComissao: 100, totalVenda: 1000, jaLiberado: 0, valor: 100, entradas: mesmo, reserva: d("2026-11-05") }))
      .toEqual([{ data: d("2026-10-25"), valor: 100 }]);
    expect(liberacaoPorMes({ valorComissao: 100, totalVenda: 1000, jaLiberado: 0, valor: 100, entradas: [], reserva: d("2026-11-05") }))
      .toEqual([{ data: d("2026-11-05"), valor: 100 }]);
  });
  it("a soma é sempre o movimento calculado (o arredondamento é pelo acumulado: 33,33 · 66,67 · 100)", () => {
    const tres = [{ data: d("2026-09-10"), valor: 333.33 }, { data: d("2026-10-10"), valor: 333.33 }, { data: d("2026-11-10"), valor: 333.34 }];
    const r = liberacaoPorMes({ valorComissao: 100, totalVenda: 1000, jaLiberado: 0, valor: 100, entradas: tres, reserva: d("2026-11-15") });
    expect(Math.round(r.reduce((s, x) => s + x.valor, 0) * 100) / 100).toBe(100);
    expect(r.map((x) => x.valor)).toEqual([33.33, 33.34, 33.33]);
  });
});
