/**
 * Retenções do faturamento, regras puras: cálculo por retenção (centavo arredondado), líquido,
 * conversão de/para as colunas da medição, validação e a sugestão do ISS conforme a nota.
 */
import { describe, expect, it } from "vitest";
import { calcularRetencoes, camposDaMedicao, motivoRetencaoInvalida, retencoesDaMedicao, sugestaoIss } from "@/lib/financeiro/retencoes";

describe("calcularRetencoes", () => {
  it("nada marcado: líquido = bruto", () => {
    expect(calcularRetencoes(1000, {})).toEqual({ bruto: 1000, linhas: [], total: 0, liquido: 1000 });
    expect(calcularRetencoes(1000, { iss: null, ir: null })).toEqual({ bruto: 1000, linhas: [], total: 0, liquido: 1000 });
  });
  it("cada retenção marcada na ordem fixa (ISS, IR, PIS, COFINS, CSLL, INSS), arredondada no centavo", () => {
    const d = calcularRetencoes(1234.56, { inss: 11, iss: 5, ir: 1.5, pis: 0.65, cofins: 3, csll: 1 });
    expect(d.linhas.map((l) => [l.rotulo, l.aliquota, l.valor])).toEqual([
      ["ISS retido", 5, 61.73], ["IR", 1.5, 18.52], ["PIS", 0.65, 8.02], ["COFINS", 3, 37.04], ["CSLL", 1, 12.35], ["INSS", 11, 135.8],
    ]);
    expect(d.total).toBe(273.46);
    expect(d.liquido).toBe(961.1);
  });
  it("sem erro de ponto flutuante na soma", () => {
    const d = calcularRetencoes(0.3, { iss: 33.33, ir: 33.33 });
    expect(d.linhas.map((l) => l.valor)).toEqual([0.1, 0.1]);
    expect(d.total).toBe(0.2);
    expect(d.liquido).toBe(0.1);
  });
});

describe("colunas da medição", () => {
  it("Decimal/texto/null → alíquotas; desmarcada = null; ida e volta", () => {
    const r = retencoesDaMedicao({ retIssAliquota: "5.00", retIrAliquota: 1.5, retPisAliquota: null });
    expect(r).toEqual({ iss: 5, ir: 1.5, pis: null, cofins: null, csll: null, inss: null });
    expect(camposDaMedicao(r)).toEqual({ retIssAliquota: 5, retIrAliquota: 1.5, retPisAliquota: null, retCofinsAliquota: null, retCsllAliquota: null, retInssAliquota: null });
    expect(camposDaMedicao({})).toEqual({ retIssAliquota: null, retIrAliquota: null, retPisAliquota: null, retCofinsAliquota: null, retCsllAliquota: null, retInssAliquota: null });
  });
});

describe("motivoRetencaoInvalida", () => {
  it("aceita alíquota em (0, 100] e desmarcada", () => {
    expect(motivoRetencaoInvalida(100, { iss: 5, ir: null })).toBeNull();
    expect(motivoRetencaoInvalida(100, { inss: 100 })).toBeNull();
    expect(motivoRetencaoInvalida(100, {})).toBeNull();
  });
  it("recusa zero, negativa, NaN, acima de 100 e retenção maior que a nota", () => {
    expect(motivoRetencaoInvalida(100, { ir: 0 })).toBe("Informe a alíquota de IR (ou desmarque).");
    expect(motivoRetencaoInvalida(100, { pis: -1 })).toBe("Informe a alíquota de PIS (ou desmarque).");
    expect(motivoRetencaoInvalida(100, { cofins: Number.NaN })).toBe("Informe a alíquota de COFINS (ou desmarque).");
    expect(motivoRetencaoInvalida(100, { csll: 100.01 })).toBe("Alíquota de CSLL acima de 100%.");
    expect(motivoRetencaoInvalida(100, { iss: 60, inss: 50 })).toBe("As retenções passam do valor da nota.");
  });
});

describe("sugestaoIss (conforme a nota)", () => {
  const ret = (a: number | null = 5) => ({ issRetido: true, aliquotaISS: a });
  it("todos os serviços com valor retidos → marca com a alíquota do serviço", () => {
    expect(sugestaoIss([{ valorTotal: 100, servico: ret(2) }, { valorTotal: 0, servico: null }, { tipo: "PRODUTO", valorTotal: 50 }], 5))
      .toEqual({ marcar: true, aliquota: 2, parcial: false });
  });
  it("serviço retido sem alíquota → a padrão da empresa", () => {
    expect(sugestaoIss([{ valorTotal: 100, servico: ret(null) }], 3)).toEqual({ marcar: true, aliquota: 3, parcial: false });
    expect(sugestaoIss([{ valorTotal: 100, servico: ret(null) }], null)).toEqual({ marcar: true, aliquota: null, parcial: false });
  });
  it("só parte retida → não marca, avisa (parcial)", () => {
    expect(sugestaoIss([{ valorTotal: 100, servico: ret(5) }, { valorTotal: 100, servico: { issRetido: false, aliquotaISS: 5 } }], 5))
      .toEqual({ marcar: false, aliquota: 5, parcial: true });
  });
  it("nenhum retido (ou sem serviço do catálogo) → nada", () => {
    expect(sugestaoIss([{ valorTotal: 100, servico: { issRetido: false } }, { valorTotal: 50, servico: null }], 5)).toEqual({ marcar: false, aliquota: null, parcial: false });
    expect(sugestaoIss([], 5)).toEqual({ marcar: false, aliquota: null, parcial: false });
  });
});
