/**
 * Contrato recorrente PR4 — regras puras do reajuste anual (D8) e do horizonte (sem limite de 10 anos).
 */
import { describe, expect, it } from "vitest";
import {
  aniversarioDevido, mesAniversarioDe, percentualDe, primeiroAniversario, proximoAniversario, reajusteSugerivel, sugestaoReajuste,
  textoCompetencia, textoPercentual, textoSugestao, valorReajustado,
} from "@/lib/contratos/reajuste";
import { competenciasDoContrato } from "@/lib/financeiro/contrato-previsao";

const base = {
  status: "ATIVO", dataInicio: new Date("2025-11-01T00:00:00.000Z"), valorMensal: 1000, reajusteAtivo: true,
  reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 5, reajusteMesAniversario: null as number | null,
};
const sp = (t: string) => t.replace(/ /g, " ");

describe("aniversário", () => {
  it("o mês: o do contrato; sem ele (ou inválido), o do início", () => {
    expect(mesAniversarioDe({ ...base, reajusteMesAniversario: 3 })).toBe(3);
    expect(mesAniversarioDe(base)).toBe(11);
    expect(mesAniversarioDe({ ...base, reajusteMesAniversario: 13 })).toBe(11);
  });
  it("o 1º vem com pelo menos 12 meses de contrato (mesmo mês, mês depois e mês antes do início)", () => {
    expect(primeiroAniversario(base)).toEqual({ ano: 2026, mes: 11 }); // 12 meses
    expect(primeiroAniversario({ ...base, reajusteMesAniversario: 12 })).toEqual({ ano: 2026, mes: 12 }); // 13
    expect(primeiroAniversario({ ...base, reajusteMesAniversario: 3 })).toEqual({ ano: 2027, mes: 3 }); // mar/26 seria 4 meses
    // 11 meses não bastam: começou em dez/2025, aniversário em novembro → nov/2027 (nov/2026 seriam 11 meses)
    expect(primeiroAniversario({ ...base, dataInicio: new Date("2025-12-01T00:00:00.000Z"), reajusteMesAniversario: 11 })).toEqual({ ano: 2027, mes: 11 });
  });
  it("devido: o mais recente que já chegou (o mês de hoje conta); antes do 1º, nenhum", () => {
    expect(aniversarioDevido(base, { ano: 2026, mes: 10 })).toBeNull();
    expect(aniversarioDevido(base, { ano: 2026, mes: 11 })).toEqual({ ano: 2026, mes: 11 });
    expect(aniversarioDevido(base, { ano: 2027, mes: 2 })).toEqual({ ano: 2026, mes: 11 });
    expect(aniversarioDevido(base, { ano: 2027, mes: 11 })).toEqual({ ano: 2027, mes: 11 });
  });
  it("próximo: o primeiro depois do mês de hoje", () => {
    expect(proximoAniversario(base, { ano: 2026, mes: 3 })).toEqual({ ano: 2026, mes: 11 });
    expect(proximoAniversario(base, { ano: 2026, mes: 11 })).toEqual({ ano: 2027, mes: 11 });
    expect(proximoAniversario(base, { ano: 2027, mes: 12 })).toEqual({ ano: 2028, mes: 11 });
    // O 1º ainda está a mais de um ano: é ele (não o "janeiro que vem")
    expect(proximoAniversario({ ...base, dataInicio: new Date("2026-03-01T00:00:00.000Z"), reajusteMesAniversario: 1 }, { ano: 2026, mes: 4 })).toEqual({ ano: 2028, mes: 1 });
  });
});

describe("percentual e valor", () => {
  it("só o percentual fixo, maior que zero", () => {
    expect(percentualDe(base)).toBe(5);
    expect(percentualDe({ reajusteIndice: "IPCA", reajustePercentual: 5 })).toBeNull();
    expect(percentualDe({ reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 0 })).toBeNull();
    expect(percentualDe({ reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: "4.125" })).toBe(4.125);
  });
  it("valor reajustado em centavos exatos", () => {
    expect(valorReajustado(1000, 5)).toBe(1050);
    expect(valorReajustado(1200, 4.5)).toBe(1254);
    expect(valorReajustado(1234.56, 4.5)).toBe(1290.12);
    expect(valorReajustado(999.99, 4.125)).toBe(1041.24);
  });
  it("sugerível: ativo, chave ligada, percentual fixo e com valor", () => {
    expect(reajusteSugerivel(base)).toBe(true);
    for (const muda of [{ status: "SUSPENSO" }, { reajusteAtivo: false }, { reajusteIndice: "IGPM" }, { valorMensal: 0 }, { reajustePercentual: null }])
      expect(reajusteSugerivel({ ...base, ...muda })).toBe(false);
  });
});

describe("a sugestão de hoje", () => {
  const hoje = { ano: 2026, mes: 11, dia: 15 };
  it("pendente no aniversário; decidido some; adiado até a data (no dia seguinte volta)", () => {
    expect(sugestaoReajuste(base, [], hoje)).toEqual({ situacao: "PENDENTE", aniversario: { ano: 2026, mes: 11 }, percentual: 5, valorAtual: 1000, valorNovo: 1050, adiadoAte: null });
    expect(sugestaoReajuste(base, [2026], hoje)).toBeNull();
    expect(sugestaoReajuste(base, [2025], hoje)!.situacao).toBe("PENDENTE"); // decisão de outro ano não conta
    const adiado = { ...base, reajusteAdiadoAte: new Date("2026-12-15T00:00:00.000Z") };
    expect(sugestaoReajuste(adiado, [], hoje)).toMatchObject({ situacao: "ADIADO", adiadoAte: "2026-12-15" });
    expect(sugestaoReajuste(adiado, [], { ano: 2026, mes: 12, dia: 15 })!.situacao).toBe("PENDENTE");
  });
  it("vem chegando: só com \"Avisar antes\", dentro dos dias e sem decisão; nunca pendente antes da hora", () => {
    const dez = { ...base, reajusteMesAniversario: 12, reajusteNotificar: true, reajusteNotificarDias: 16 };
    expect(sugestaoReajuste(dez, [], hoje)).toMatchObject({ situacao: "EM_BREVE", aniversario: { ano: 2026, mes: 12 } });
    expect(sugestaoReajuste({ ...dez, reajusteNotificarDias: 15 }, [], hoje)).toBeNull(); // 16 dias até 1º/dez
    expect(sugestaoReajuste({ ...dez, reajusteNotificar: false }, [], hoje)).toBeNull();
    expect(sugestaoReajuste(dez, [2026], hoje)).toBeNull();
    expect(sugestaoReajuste({ ...base, status: "ENCERRADO" }, [], hoje)).toBeNull();
  });
  it("textos curtos", () => {
    expect([textoPercentual(5), textoPercentual(4.5), textoPercentual(4.125), textoCompetencia({ ano: 2027, mes: 3 })]).toEqual(["5%", "4,5%", "4,125%", "mar/2027"]);
    expect(sp(textoSugestao("CT-7", { aniversario: { ano: 2027, mes: 3 }, percentual: 5, valorAtual: 1200, valorNovo: 1260 })))
      .toBe("Contrato CT-7 faz aniversário em mar/2027 — aplicar reajuste de 5% (R$ 1.200,00 → R$ 1.260,00)?");
  });
});

describe("horizonte", () => {
  it("contrato indeterminado com mais de 10 anos continua com a janela de ~12 meses (antes parava em 120 meses do início)", () => {
    const hoje = new Date(2026, 10, 15);
    const lista = competenciasDoContrato(new Date(2014, 2, 1), null, hoje);
    const futuras = lista.filter((c) => c.ano * 12 + c.mes >= 2026 * 12 + 11);
    expect(futuras).toHaveLength(13);
    expect(futuras.at(-1)).toEqual({ ano: 2027, mes: 11 });
    expect(competenciasDoContrato(new Date(2014, 2, 1), null, hoje, 3).filter((c) => c.ano >= 2027).map((c) => c.mes)).toEqual([3, 6, 9]);
  });
});
