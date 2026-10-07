/**
 * Custo de Pessoal — cálculo de gestão (custo mensal = base + adicionais + encargos + benefícios − descontos).
 */
import { describe, expect, it } from "vitest";
import {
  MODELOS_PADRAO, baseMensal, calcularCusto, competenciaAnterior, competenciaValida, horasDoMes, rotuloCompetencia, somaPercentuais,
} from "@/lib/folha/calculo";

const CLT = MODELOS_PADRAO.find((m) => m.regime === "CLT")!.itens;

describe("calcularCusto", () => {
  it("CLT: salário + periculosidade + HE, encargos do modelo, benefícios e 6% de VT", () => {
    const c = calcularCusto({
      regime: "CLT", salario: 3000, adicionalTipo: "PERICULOSIDADE", adicionalPercent: 30, horasExtrasValor: 100,
      valeTransporte: 220, descontaVt: true, valeAlimentacao: 600, planoSaude: 350,
    }, CLT);
    expect(c.base).toBe(3000);
    expect(c.adicional).toBe(900);
    expect(c.remuneracao).toBe(4000);
    expect(c.percentualEncargos).toBe(55.24); // 20 + 2 + 5,8 + 8 + 8,33 + 11,11
    expect(c.encargos).toBeCloseTo(4000 * 0.5524, 1);
    expect(c.beneficios).toBe(1170);
    expect(c.descontoVt).toBe(180); // 6% de 3000 (menor que o VT de 220)
    expect(c.total).toBeCloseTo(4000 + c.encargos + 1170 - 180, 2);
    expect(c.horasMes).toBe(220);
    expect(c.custoHora).toBeCloseTo(c.total / 220, 2);
  });

  it("desconto de VT nunca passa do próprio VT e não existe fora da CLT ou se desmarcado", () => {
    expect(calcularCusto({ regime: "CLT", salario: 10000, valeTransporte: 100 }, []).descontoVt).toBe(100);
    expect(calcularCusto({ regime: "CLT", salario: 3000, valeTransporte: 220, descontaVt: false }, []).descontoVt).toBe(0);
    expect(calcularCusto({ regime: "PJ", salario: 3000, valeTransporte: 220 }, []).descontoVt).toBe(0);
  });

  it("adicional em valor fixo tem prioridade sobre o percentual; tipo NENHUM ignora os dois", () => {
    expect(calcularCusto({ regime: "CLT", salario: 2000, adicionalTipo: "INSALUBRIDADE", adicionalPercent: 20, adicionalValor: 303.6 }, []).adicional).toBe(303.6);
    expect(calcularCusto({ regime: "CLT", salario: 2000, adicionalTipo: "NENHUM", adicionalPercent: 20, adicionalValor: 300 }, []).adicional).toBe(0);
  });

  it("diarista: base = diária × dias; horas = dias × 8 se não informadas; sem encargos no modelo padrão", () => {
    const itens = MODELOS_PADRAO.find((m) => m.regime === "DIARISTA")!.itens;
    const c = calcularCusto({ regime: "DIARISTA", valorDiaria: 150, diasMes: 20 }, itens);
    expect(c.base).toBe(3000);
    expect(c.encargos).toBe(0);
    expect(c.horasMes).toBe(160);
    expect(c.custoHora).toBe(18.75);
  });

  it("PJ sem encargos; autônomo com 20% de INSS patronal sobre o RPA", () => {
    const pj = MODELOS_PADRAO.find((m) => m.regime === "PJ")!.itens;
    const aut = MODELOS_PADRAO.find((m) => m.regime === "AUTONOMO")!.itens;
    expect(calcularCusto({ regime: "PJ", salario: 8000 }, pj).total).toBe(8000);
    expect(calcularCusto({ regime: "AUTONOMO", salario: 2000 }, aut).total).toBe(2400);
  });

  it("valores vazios, negativos ou inválidos contam como zero; total nunca fica negativo", () => {
    const c = calcularCusto({ regime: "CLT", salario: null, valeTransporte: -5, descontos: 999 }, CLT);
    expect(c.total).toBe(0);
    expect(c.custoHora).toBe(0);
  });

  it("helpers: base, horas, soma de percentuais e competências", () => {
    expect(baseMensal({ regime: "DIARISTA", salario: 5000 })).toBe(5000); // sem diária, usa o salário
    expect(horasDoMes({ regime: "CLT", horasMes: 180 })).toBe(180);
    expect(somaPercentuais([{ nome: "a", percentual: 8.33 }, { nome: "b", percentual: 11.11 }])).toBe(19.44);
    expect(competenciaValida("2026-10")).toBe(true);
    expect(competenciaValida("2026-13")).toBe(false);
    expect(competenciaValida("10/2026")).toBe(false);
    expect(competenciaAnterior("2026-01")).toBe("2025-12");
    expect(competenciaAnterior("2026-10", 11)).toBe("2025-11");
    expect(rotuloCompetencia("2026-10")).toBe("out/26");
    expect(rotuloCompetencia("2026-10", true)).toBe("outubro de 2026");
  });
});
