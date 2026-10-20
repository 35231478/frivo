/**
 * E2.1 — parcelas da conta a pagar da nota (puro): padrão = duplicatas da NF; mudar o nº de parcelas
 * redistribui o valor da nota; vencimentos um a um ou todos de uma vez (mensal ou a cada N dias);
 * soma ≠ valor da nota só avisa.
 */
import { describe, expect, it } from "vitest";
import {
  aplicarVencimentos, avisoSomaParcelas, dividir, igualANf, parcelasDaNf, redistribuir, somaParcelas, somarDias, somarMeses, type ParcelaRascunho,
} from "@/lib/compras/parcelas";
import { conciliacaoSchema, financeiroSchema, mensagemZod } from "@/lib/compras/validacao";

const DUPS: ParcelaRascunho[] = [
  { duplicata: "001", vencimento: "2026-11-14", valor: 583.1, boleto: "10492006506100010004200997263900989810000021403" },
  { duplicata: "002", vencimento: "2026-12-14", valor: 583.1, boleto: null },
  { duplicata: "003", vencimento: "2027-01-13", valor: 583.1, boleto: null },
];
const venc = (ps: ParcelaRascunho[]) => ps.map((p) => p.vencimento);
const vals = (ps: ParcelaRascunho[]) => ps.map((p) => p.valor);

describe("parcelas da NF", () => {
  it("as duplicatas; sem duplicata, uma à vista no valor da nota, no dia da emissão em Brasília", () => {
    expect(parcelasDaNf({ duplicatas: [{ numero: "001", vencimento: "2026-11-14", valor: 583.1 }], valorTotal: 583.1, dataEmissao: new Date() }))
      .toEqual([{ duplicata: "001", vencimento: "2026-11-14", valor: 583.1, boleto: null }]);
    // 23h30 em Brasília = outro dia em UTC: continua o dia de Brasília
    expect(parcelasDaNf({ duplicatas: [], valorTotal: 829.1, dataEmissao: new Date("2026-11-03T23:30:00-03:00") }))
      .toEqual([{ duplicata: null, vencimento: "2026-11-03", valor: 829.1, boleto: null }]);
  });
});

describe("mudar o nº de parcelas redistribui o valor da nota", () => {
  it("divide em partes iguais; os centavos que sobram vão para a última", () => {
    expect(dividir(1749.3, 2)).toEqual([874.65, 874.65]);
    expect(dividir(1000, 3)).toEqual([333.33, 333.33, 333.34]);
    expect(dividir(0.05, 3)).toEqual([0.01, 0.01, 0.03]);
    expect(dividir(100, 1)).toEqual([100]);
    expect(somaParcelas(dividir(1749.3, 7).map((valor) => ({ valor })))).toBe(1749.3);
  });

  it("3 → 2: ficam os 2 primeiros vencimentos e o boleto da que continua; a numeração das duplicatas sai", () => {
    const dois = redistribuir(DUPS, 2, 1749.3, "2026-10-20");
    expect(vals(dois)).toEqual([874.65, 874.65]);
    expect(venc(dois)).toEqual(["2026-11-14", "2026-12-14"]);
    expect(dois.map((p) => p.duplicata)).toEqual([null, null]);
    expect(dois[0].boleto).toBe(DUPS[0].boleto);
  });

  it("3 → 5: as novas vencem mês a mês depois da última", () => {
    const cinco = redistribuir(DUPS, 5, 1749.3, "2026-10-20");
    expect(venc(cinco)).toEqual(["2026-11-14", "2026-12-14", "2027-01-13", "2027-02-13", "2027-03-13"]);
    expect(vals(cinco)).toEqual([349.86, 349.86, 349.86, 349.86, 349.86]);
  });

  it("limites: 0 ou inválido vira 1; mais de 120 vira 120; sem parcela nenhuma, começa hoje", () => {
    expect(redistribuir(DUPS, 0, 100, "2026-10-20")).toHaveLength(1);
    expect(redistribuir(DUPS, Number.NaN, 100, "2026-10-20")).toHaveLength(1);
    expect(redistribuir(DUPS, 500, 100, "2026-10-20")).toHaveLength(120);
    expect(venc(redistribuir([], 2, 100, "2026-10-20"))).toEqual(["2026-10-20", "2026-11-20"]);
  });
});

describe("vencimentos", () => {
  it("mês a mês: dia 31 em mês curto vira o último dia (e 29/02 no bissexto)", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(somarMeses("2026-12-15", 1)).toBe("2027-01-15");
    expect(somarMeses("2026-03-31", -1)).toBe("2026-02-28");
    expect(somarDias("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("todos de uma vez: 1º vencimento + mensal (mesmo dia) ou a cada N dias", () => {
    expect(venc(aplicarVencimentos(DUPS, "2026-11-30", "mensal"))).toEqual(["2026-11-30", "2026-12-30", "2027-01-30"]);
    expect(venc(aplicarVencimentos(DUPS, "2026-11-30", 15))).toEqual(["2026-11-30", "2026-12-15", "2026-12-30"]);
    expect(vals(aplicarVencimentos(DUPS, "2026-11-30", 15))).toEqual(vals(DUPS)); // só mexe nas datas
  });
});

describe("soma ≠ valor da nota: só avisa", () => {
  it("bate = sem aviso; falta ou sobra = o aviso com a diferença", () => {
    expect(avisoSomaParcelas(DUPS, 1749.3)).toBeNull();
    expect(avisoSomaParcelas([{ valor: 500 }, { valor: 500 }, { valor: 700 }], 1749.3)?.replace(/ /g, " "))
      .toBe("As parcelas somam R$ 1.700,00 e a nota é de R$ 1.749,30 (faltam R$ 49,30). As contas a pagar seguem as parcelas.");
    expect(avisoSomaParcelas([{ valor: 1749.31 }], 1749.3)).toMatch(/\(sobram R\$\s0,01\)/);
  });

  it("igual à NF: mesmas datas, valores e duplicatas", () => {
    expect(igualANf(DUPS.map((p) => ({ ...p })), DUPS)).toBe(true);
    expect(igualANf(DUPS.slice(0, 2), DUPS)).toBe(false);
    expect(igualANf([{ ...DUPS[0], valor: 583.11 }, DUPS[1], DUPS[2]], DUPS)).toBe(false);
    expect(igualANf([{ ...DUPS[0], vencimento: "2026-11-15" }, DUPS[1], DUPS[2]], DUPS)).toBe(false);
  });
});

describe("validação do rascunho financeiro", () => {
  it("boleto colado vira só os dígitos da linha; valor com 2 casas; campo a mais recusa", () => {
    const r = financeiroSchema.parse({ parcelas: [{ vencimento: "2026-11-20", valor: 874.649, boleto: "10499898100000214032006561000100040099726390" }] });
    expect(r.parcelas).toEqual([{ duplicata: null, vencimento: "2026-11-20", valor: 874.65, boleto: "10492006506100010004200997263900989810000021403" }]);
    expect(financeiroSchema.parse({ categoriaId: "", formaPagamento: "" })).toEqual({ categoriaId: null, formaPagamento: null });
    expect(financeiroSchema.safeParse({ formaPagamento: "BITCOIN" }).success).toBe(false);
    expect(financeiroSchema.safeParse({ empresaId: "x" }).success).toBe(false);
  });

  it("a mensagem diz qual parcela", () => {
    const e = conciliacaoSchema.safeParse({ itens: [], financeiro: { parcelas: [{ vencimento: "2026-11-20", valor: 1 }, { vencimento: "20/11/2026", valor: 1 }] } });
    expect(e.success).toBe(false);
    expect(mensagemZod(e.error!)).toBe("Parcela 2: Vencimento inválido (use AAAA-MM-DD).");
  });
});
