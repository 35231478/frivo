/**
 * Retenções do faturamento, regras puras: cálculo por retenção (centavo arredondado), líquido,
 * conversão de/para as colunas da medição, validação e a sugestão do ISS conforme a nota.
 */
import { describe, expect, it } from "vitest";
import {
  calcularRetencoes, camposDaMedicao, motivoRetencaoInvalida, motivoRetencaoServicoInvalida, resumoRetencoes, retencoesDaMedicao,
  retencoesDosServicos, type Retencoes,
} from "@/lib/financeiro/retencoes";

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

describe("retencoesDosServicos (herdadas do cadastro do serviço)", () => {
  const iss = (a: number | null = 5) => ({ issRetido: true, aliquotaISS: a });
  const so = (r: Retencoes) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null));
  it("ISS: todos os serviços com valor retidos → vale com a alíquota do serviço; produtos e itens zerados não contam", () => {
    const r = retencoesDosServicos([{ valorTotal: 100, servico: iss(2) }, { valorTotal: 0, servico: null }, { tipo: "PRODUTO", valorTotal: 50 }], 5);
    expect(so(r.retencoes)).toEqual({ iss: 2 });
    expect(r.parciais).toEqual([]);
  });
  it("ISS retido sem alíquota → a padrão da empresa; sem padrão → não vale (o editor pede a alíquota)", () => {
    expect(so(retencoesDosServicos([{ valorTotal: 100, servico: iss(null) }], 3).retencoes)).toEqual({ iss: 3 });
    expect(so(retencoesDosServicos([{ valorTotal: 100, servico: iss(null) }], null).retencoes)).toEqual({});
  });
  it("federais: só com a caixinha \"reter\" marcada e a alíquota do serviço (alíquota sozinha não retém)", () => {
    const r = retencoesDosServicos([
      { valorTotal: 100, servico: { retIr: true, aliquotaIR: 1.5, retCsll: true, aliquotaCSLL: "1.00", aliquotaPIS: 0.65, retInss: true, aliquotaINSS: 11 } },
    ], 5);
    expect(so(r.retencoes)).toEqual({ ir: 1.5, csll: 1, inss: 11 });
    expect(r.aliquotas.pis).toBe(0.65);
  });
  it("Simples Nacional (nada marcado) → nada; sem serviço do catálogo → nada", () => {
    expect(so(retencoesDosServicos([{ valorTotal: 100, servico: { aliquotaIR: 1.5, aliquotaPIS: 0.65 } }, { valorTotal: 50, servico: null }], 5).retencoes)).toEqual({});
    expect(retencoesDosServicos([], 5)).toEqual({ retencoes: { iss: null, ir: null, pis: null, cofins: null, csll: null, inss: null }, parciais: [], aliquotas: { iss: 5, ir: null, pis: null, cofins: null, csll: null, inss: null } });
  });
  it("só parte dos serviços retém → não vale, vai em parciais (com a alíquota para o editor)", () => {
    const r = retencoesDosServicos([{ valorTotal: 100, servico: { ...iss(5), retIr: true, aliquotaIR: 1.5 } }, { valorTotal: 100, servico: { issRetido: false, aliquotaISS: 5 } }], 5);
    expect(so(r.retencoes)).toEqual({});
    expect(r.parciais).toEqual(["iss", "ir"]);
    expect(r.aliquotas).toMatchObject({ iss: 5, ir: 1.5 });
  });
});

describe("motivoRetencaoServicoInvalida (cadastro do serviço)", () => {
  it("\"reter\" marcado exige alíquota > 0; desmarcado ou ISS (herda a da empresa) passam", () => {
    expect(motivoRetencaoServicoInvalida({ retIr: true })).toBe("Informe a alíquota de IR para reter (ou desmarque).");
    expect(motivoRetencaoServicoInvalida({ retInss: true, aliquotaINSS: 0 })).toBe("Informe a alíquota de INSS para reter (ou desmarque).");
    expect(motivoRetencaoServicoInvalida({ retPis: true, aliquotaPIS: "" })).toBe("Informe a alíquota de PIS para reter (ou desmarque).");
    expect(motivoRetencaoServicoInvalida({ retCofins: true, aliquotaCOFINS: 3 })).toBeNull();
    expect(motivoRetencaoServicoInvalida({ retCsll: false, aliquotaCSLL: null, issRetido: true, aliquotaISS: null })).toBeNull();
  });
});

describe("resumoRetencoes (linha discreta do faturamento)", () => {
  const moeda = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
  it("\"ISS retido 5% (−R$ 140,00) · IR 1,5% (−R$ 42,00)\"; sem retenção → vazio", () => {
    expect(resumoRetencoes(calcularRetencoes(2800, { iss: 5, ir: 1.5 }), moeda)).toBe("ISS retido 5% (−R$ 140,00) · IR 1,5% (−R$ 42,00)");
    expect(resumoRetencoes(calcularRetencoes(2800, {}), moeda)).toBe("");
  });
});
