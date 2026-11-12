/**
 * Orçamento — o cálculo puro (lib/orcamentos/calculo.ts): item (unitário ↔ total), desconto por grupo,
 * ISS sobre os serviços líquidos, versão do CLIENTE com o ISS embutido (contas fechando ao centavo)
 * e a validade padrão (+10 dias).
 */
import { describe, expect, it } from "vitest";
import {
  calcularOrcamento, repartir, round2, totalCoerente, totalDoItem, totalDoUnitario, unitarioDoTotal,
  validadePadrao, valorDesconto, versaoCliente, type EntradaCalculo,
} from "@/lib/orcamentos/calculo";

const soma = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

describe("item: unitário ↔ total", () => {
  it("unitário × qtd arredondado em centavos", () => {
    expect(totalDoUnitario(3, 33.33)).toBe(99.99);
    expect(totalDoUnitario(2.5, 10.01)).toBe(25.03); // 25,025 → 25,03
    expect(totalDoUnitario("2", "150.5")).toBe(301);
  });

  it("total ÷ qtd em centavos; quantidade zero não divide", () => {
    expect(unitarioDoTotal(100, 3)).toBe(33.33);
    expect(unitarioDoTotal(200, 3)).toBe(66.67);
    expect(unitarioDoTotal(100, 0)).toBe(0);
    expect(unitarioDoTotal(100, -1)).toBe(0);
  });

  it("o total digitado manda quando bate com o unitário arredondado (R$ 100 em 3 un. = 33,33 cada)", () => {
    expect(totalCoerente(3, 33.33, 100)).toBe(true);
    expect(totalDoItem({ quantidade: 3, valorUnitario: 33.33, valorTotal: 100 })).toBe(100);
    expect(totalDoItem({ quantidade: 3, valorUnitario: 66.67, valorTotal: 200 })).toBe(200);
  });

  it("total incoerente (adulterado ou de outro unitário) é ignorado: vale unitário × qtd", () => {
    expect(totalCoerente(3, 33.33, 150)).toBe(false);
    expect(totalDoItem({ quantidade: 3, valorUnitario: 33.33, valorTotal: 150 })).toBe(99.99);
    expect(totalDoItem({ quantidade: 2, valorUnitario: 10 })).toBe(20);
    expect(totalDoItem({ quantidade: 2, valorUnitario: 10, valorTotal: "" })).toBe(20);
  });
});

describe("desconto do grupo", () => {
  it("R$ ou %, nunca negativo nem maior que o subtotal", () => {
    expect(valorDesconto(1000, 10, "PERCENTUAL")).toBe(100);
    expect(valorDesconto(1000, 150, "VALOR")).toBe(150);
    expect(valorDesconto(1000, 1500, "VALOR")).toBe(1000);
    expect(valorDesconto(1000, 250, "PERCENTUAL")).toBe(1000);
    expect(valorDesconto(1000, -5, "VALOR")).toBe(0);
    expect(valorDesconto(333.33, 7.5, "PERCENTUAL")).toBe(25);
  });
});

describe("calcularOrcamento: subtotal → desconto → ISS → total", () => {
  const base: EntradaCalculo = {
    servicos: [{ quantidade: 1, valorUnitario: 800 }, { quantidade: 2, valorUnitario: 100 }],
    produtos: [{ quantidade: 4, valorUnitario: 50 }],
  };

  it("sem desconto nem ISS: soma simples", () => {
    const t = calcularOrcamento(base);
    expect(t).toMatchObject({ subtotalServicos: 1000, descontoServicos: 0, valorIss: 0, totalServicos: 1000, subtotalProdutos: 200, totalProdutos: 200, totalGeral: 1200 });
  });

  it("ISS sobre os serviços JÁ com o desconto deles, somado ao total; produtos não pagam ISS", () => {
    const t = calcularOrcamento({ ...base, descontoServicos: 10, tipoDescontoServicos: "PERCENTUAL", descontoProdutos: 20, tipoDescontoProdutos: "VALOR", issAliquota: 5 });
    expect(t).toEqual({
      subtotalServicos: 1000, descontoServicos: 100, servicosLiquidos: 900, issAliquota: 5, valorIss: 45, totalServicos: 945,
      subtotalProdutos: 200, descontoProdutos: 20, totalProdutos: 180, descontoTotal: 120, totalGeral: 1125,
    });
  });

  it("alíquota com centavos e arredondamento", () => {
    const t = calcularOrcamento({ servicos: [{ quantidade: 3, valorUnitario: 33.33, valorTotal: 100 }], produtos: [], issAliquota: 2.79 });
    expect(t.valorIss).toBe(2.79);
    expect(t.totalGeral).toBe(102.79);
  });

  it("alíquota fora da faixa é limitada a 0–100", () => {
    expect(calcularOrcamento({ ...base, issAliquota: -3 }).valorIss).toBe(0);
    expect(calcularOrcamento({ ...base, issAliquota: 500 }).valorIss).toBe(1000);
  });
});

describe("repartir: maior resto, sem perder centavo", () => {
  it("soma exatamente o alvo", () => {
    expect(repartir(100, [1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
    expect(soma(repartir(1050, [800, 200]))).toBe(1050);
    expect(repartir(10, [])).toEqual([]);
    expect(repartir(10, [0, 0])).toEqual([10, 0]);
  });
});

describe("versaoCliente: ISS embutido nos serviços, sem linha própria", () => {
  it("sem ISS: igual ao interno, sem a nota de impostos", () => {
    const v = versaoCliente({ servicos: [{ quantidade: 2, valorUnitario: 50 }], produtos: [{ quantidade: 1, valorUnitario: 30 }] });
    expect(v.impostosInclusos).toBe(false);
    expect(v.servicos).toEqual([{ quantidade: 2, valorUnitario: 50, valorTotal: 100 }]);
    expect(v.totalGeral).toBe(130);
  });

  it("com ISS e sem desconto: itens somam o total dos serviços com ISS; total geral igual ao interno", () => {
    const e: EntradaCalculo = {
      servicos: [{ quantidade: 1, valorUnitario: 800 }, { quantidade: 3, valorUnitario: 33.33, valorTotal: 100 }, { quantidade: 1, valorUnitario: 0.01 }],
      produtos: [{ quantidade: 2, valorUnitario: 25 }], issAliquota: 5,
    };
    const t = calcularOrcamento(e);
    const v = versaoCliente(e);
    expect(v.impostosInclusos).toBe(true);
    expect(v.subtotalServicos).toBe(t.totalServicos);
    expect(v.descontoServicos).toBe(0);
    expect(soma(v.servicos.map((s) => s.valorTotal))).toBe(v.subtotalServicos);
    expect(v.servicos[0].valorTotal).toBe(840);
    expect(v.totalGeral).toBe(t.totalGeral);
    expect(round2(v.totalServicos + v.totalProdutos)).toBe(v.totalGeral);
  });

  it("com ISS e desconto: subtotal − desconto = total dos serviços com ISS, ao centavo", () => {
    const e: EntradaCalculo = {
      servicos: [{ quantidade: 1, valorUnitario: 777.77 }, { quantidade: 7, valorUnitario: 13.13 }],
      produtos: [], descontoServicos: 12.5, tipoDescontoServicos: "PERCENTUAL", issAliquota: 3.5,
    };
    const t = calcularOrcamento(e);
    const v = versaoCliente(e);
    expect(soma(v.servicos.map((s) => s.valorTotal))).toBe(v.subtotalServicos);
    expect(round2(v.subtotalServicos - v.descontoServicos)).toBe(t.totalServicos);
    expect(v.totalGeral).toBe(t.totalGeral);
    // o unitário mostrado é o total ÷ qtd
    expect(v.servicos[1].valorUnitario).toBe(round2(v.servicos[1].valorTotal / 7));
  });

  it("varredura: as contas fecham para muitas combinações", () => {
    for (let a = 0; a <= 10; a += 0.37) {
      for (const d of [0, 3, 33.3]) {
        const e: EntradaCalculo = {
          servicos: [{ quantidade: 3, valorUnitario: 19.99 }, { quantidade: 1, valorUnitario: 0.05 }, { quantidade: 2.5, valorUnitario: 41.41 }],
          produtos: [{ quantidade: 1, valorUnitario: 9.9 }], descontoServicos: d, tipoDescontoServicos: "PERCENTUAL", issAliquota: round2(a),
        };
        const t = calcularOrcamento(e);
        const v = versaoCliente(e);
        expect(soma(v.servicos.map((s) => s.valorTotal))).toBe(v.subtotalServicos);
        expect(round2(v.subtotalServicos - v.descontoServicos)).toBe(t.totalServicos);
        expect(v.totalGeral).toBe(t.totalGeral);
        expect(v.descontoServicos).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("validade padrão", () => {
  it("data do orçamento + 10 dias, virando mês e ano", () => {
    expect(validadePadrao("2026-10-26")).toBe("2026-11-05");
    expect(validadePadrao("2026-12-25")).toBe("2027-01-04");
    expect(validadePadrao("2028-02-25")).toBe("2028-03-06");
    expect(validadePadrao("2026-10-26", 30)).toBe("2026-11-25");
  });
});
