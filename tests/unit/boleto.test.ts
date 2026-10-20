/**
 * E2.1 — boleto colado na conta a pagar ("DDA manual"): linha digitável (47 bancário / 48 convênio) ou
 * código de barras (44), com os dígitos verificadores FEBRABAN. Puro.
 *
 * Os vetores são boletos reais publicados nos testes de uma biblioteca aberta de boletos
 * (@mrmgomes/boleto-utils) — a implementação daqui foi cruzada com ela em 2.900 bancários e 16.000
 * convênios aleatórios (diferença só no resto 0/1 do módulo 11 do boleto BANCÁRIO, onde a FEBRABAN
 * manda DV = 1 e aquela biblioteca dá 0; ver o teste "DV geral bancário nunca é 0").
 */
import { describe, expect, it } from "vitest";
import {
  avisoValorBoleto, formatarLinhaDigitavel, lerBoleto, modulo10, modulo11Banco, modulo11Convenio, nomeBanco, vencimentoDoFator,
} from "@/lib/financeiro/boleto";
import { boletoParaGravar } from "@/lib/financeiro/boleto-conta";

const BANCARIO = { linha: "10492006506100010004200997263900989810000021403", barras: "10499898100000214032006561000100040099726390" };
const BANCARIO_SEM_VALOR = { linha: "23794150099001980167035000211405700000000000000", barras: "23797000000000000004150090019801673500021140" };
const ITAU = { linha: "34192220090000556638551012140003679060000100000", barras: "34196790600001000002220000005566385101214000" };
const CONVENIO_MOD11 = { linha: "838600000050096000190009000801782309000343062712", barras: "83860000005096000190000008017823000034306271" };
const CONVENIO_MOD10 = { linha: "846300000003299902962024004101360008002006441147", barras: "84630000000299902962020041013600000200644114" };
const HOJE = new Date("2026-10-20T12:00:00Z");

const ok = (t: string, hoje = HOJE) => { const r = lerBoleto(t, hoje); if (!r.ok) throw new Error(r.erro); return r.boleto; };
const erro = (t: string) => { const r = lerBoleto(t, HOJE); return r.ok ? null : r.erro; };
const trocar = (s: string, pos: number, d: number) => s.slice(0, pos) + ((Number(s[pos]) + d) % 10) + s.slice(pos + 1);

describe("linha digitável ↔ código de barras", () => {
  it("bancário: 47 dígitos viram o código de 44 e vice-versa (banco, valor e vencimento saem do código)", () => {
    expect(ok(BANCARIO.linha)).toEqual({
      tipo: "bancario", linhaDigitavel: BANCARIO.linha, codigoBarras: BANCARIO.barras, banco: "104", emissor: "Caixa", valor: 214.03, vencimento: "2022-05-10",
    });
    expect(ok(BANCARIO.barras)).toMatchObject({ linhaDigitavel: BANCARIO.linha, codigoBarras: BANCARIO.barras });
    expect(ok(ITAU.barras)).toMatchObject({ linhaDigitavel: ITAU.linha, banco: "341", emissor: "Itaú", valor: 1000 });
    expect(ok(ITAU.linha).codigoBarras).toBe(ITAU.barras);
    // sem fator e sem valor (valor em aberto): os dois ficam vazios
    expect(ok(BANCARIO_SEM_VALOR.linha)).toMatchObject({ codigoBarras: BANCARIO_SEM_VALOR.barras, banco: "237", emissor: "Bradesco", valor: null, vencimento: null });
  });

  it("convênio (contas de consumo, tributos): 48 dígitos ↔ 44, com módulo 10 (id 6/7) ou 11 (id 8/9)", () => {
    expect(ok(CONVENIO_MOD11.linha)).toEqual({
      tipo: "convenio", linhaDigitavel: CONVENIO_MOD11.linha, codigoBarras: CONVENIO_MOD11.barras, banco: null,
      emissor: "Energia elétrica e gás", valor: 509.6, vencimento: null,
    });
    expect(ok(CONVENIO_MOD11.barras).linhaDigitavel).toBe(CONVENIO_MOD11.linha);
    expect(ok(CONVENIO_MOD10.linha)).toMatchObject({ codigoBarras: CONVENIO_MOD10.barras, emissor: "Telecomunicações", valor: 29.99 });
    expect(ok(CONVENIO_MOD10.barras).linhaDigitavel).toBe(CONVENIO_MOD10.linha);
  });

  it("aceita como vem do app do banco: com pontos, espaços e hífens", () => {
    expect(ok("10492.00650 61000.100042 00997.263900 9 89810000021403").codigoBarras).toBe(BANCARIO.barras);
    expect(ok("83860000005-0 09600019000-9 00080178230-9 00034306271-2").codigoBarras).toBe(CONVENIO_MOD11.barras);
    expect(formatarLinhaDigitavel(BANCARIO.linha)).toBe("10492.00650 61000.100042 00997.263900 9 89810000021403");
    expect(formatarLinhaDigitavel(CONVENIO_MOD11.linha)).toBe("83860000005-0 09600019000-9 00080178230-9 00034306271-2");
  });
});

describe("dígitos verificadores", () => {
  it("qualquer dígito digitado errado (toda posição, todo dígito) é recusado — nos 5 boletos", () => {
    for (const v of [BANCARIO.linha, ITAU.linha, CONVENIO_MOD11.linha, CONVENIO_MOD10.linha, "858200000007572503282030560708202107539591904460"])
      for (let p = 0; p < v.length; p++) for (let d = 1; d <= 9; d++) expect(lerBoleto(trocar(v, p, d)).ok, `${v} pos ${p} +${d}`).toBe(false);
  });

  it("diz ONDE está o erro: campo 1, 2, 3 ou o dígito geral (bancário); bloco (convênio); código de barras", () => {
    expect(erro(trocar(BANCARIO.linha, 2, 1))).toBe("Dígito verificador não confere no campo 1 da linha digitável: confira a digitação (ou cole de novo).");
    expect(erro(trocar(BANCARIO.linha, 12, 1))).toMatch(/no campo 2 da linha/);
    expect(erro(trocar(BANCARIO.linha, 25, 1))).toMatch(/no campo 3 da linha/);
    expect(erro(trocar(BANCARIO.linha, 40, 1))).toMatch(/no dígito geral do boleto \(campo 4\)/);
    expect(erro(trocar(CONVENIO_MOD11.linha, 30, 1))).toMatch(/no bloco 3 da linha/);
    expect(erro(trocar(BANCARIO.barras, 30, 1))).toMatch(/no código de barras/);
    expect(erro(trocar(CONVENIO_MOD10.barras, 30, 1))).toMatch(/no código de barras/);
  });

  it("tamanho errado, convênio que não começa com 8 e identificador inválido: recusados com o motivo", () => {
    expect(erro(BANCARIO.linha.slice(0, 46))).toBe("Boleto incompleto: a linha digitável tem 47 dígitos (boleto bancário) ou 48 (contas de consumo e tributos), e o código de barras, 44. Veio 46 dígitos.");
    expect(erro("1")).toMatch(/Veio 1 dígito\.$/);
    expect(erro("   ")).toBe("Cole a linha digitável ou o código de barras do boleto.");
    expect(erro("7" + CONVENIO_MOD11.linha.slice(1))).toMatch(/começa com 8/);
    expect(erro("835" + CONVENIO_MOD11.linha.slice(3))).toMatch(/3º dígito deve ser 6, 7, 8 ou 9/);
    expect(erro("835" + CONVENIO_MOD11.barras.slice(3))).toMatch(/3º dígito deve ser 6, 7, 8 ou 9/);
  });

  it("módulo 10 e módulo 11 (FEBRABAN)", () => {
    expect(modulo10("001905009")).toBe(5);
    expect(modulo10("0")).toBe(0);
    // convênio: resto 0 ou 1 → 0
    expect(modulo11Convenio("0")).toBe(0);
    expect(modulo11Convenio("5")).toBe(1); // 5×2 = 10 → resto 10 → 11 − 10 = 1
  });

  it("DV geral bancário nunca é 0: resto 0 ou 1 dá 1 (FEBRABAN)", () => {
    expect(modulo11Banco("0")).toBe(1); // resto 0 → 11 → 1
    expect(modulo11Banco("5")).toBe(1); // resto 10 → 1
    expect(modulo11Banco("6")).toBe(1); // 6×2 = 12 → resto 1 → 10 → 1
    expect(modulo11Banco("1")).toBe(9); // 2 → resto 2 → 9
    for (let i = 0; i < 200; i++) expect(modulo11Banco(String(i).padStart(43, "7"))).toBeGreaterThan(0);
  });
});

describe("valor, vencimento e emissor", () => {
  it("fator de vencimento recomeçou em 1000 em 22/02/2025: vale a data mais perto da referência", () => {
    expect(vencimentoDoFator(0)).toBeNull();
    expect(vencimentoDoFator(1000, HOJE)).toBe("2025-02-22");
    expect(vencimentoDoFator(1605, HOJE)).toBe("2026-10-20"); // 22/02/2025 + 605 dias
    expect(vencimentoDoFator(9999, new Date("2025-02-01T12:00:00Z"))).toBe("2025-02-21");
    expect(vencimentoDoFator(8981, new Date("2022-05-01T12:00:00Z"))).toBe("2022-05-10");
    // o mesmo fator 8981 em 2050 é a data nova
    expect(vencimentoDoFator(8981, new Date("2050-01-01T12:00:00Z"))).toBe("2046-12-30"); // 22/02/2025 + 7.981 dias
  });

  it("banco pelo código; desconhecido vira 'Banco NNN'", () => {
    expect(nomeBanco("001")).toBe("Banco do Brasil");
    expect(nomeBanco("756")).toBe("Sicoob");
    expect(nomeBanco("999")).toBe("Banco 999");
  });

  it("convênio com 'valor de referência' (id 7/9) não tem valor em R$", () => {
    const semValor = CONVENIO_MOD11.barras.slice(0, 2) + "9" + CONVENIO_MOD11.barras.slice(3);
    const dv = modulo11Convenio(semValor.slice(0, 3) + semValor.slice(4));
    const r = ok(semValor.slice(0, 3) + dv + semValor.slice(4));
    expect(r.valor).toBeNull();
  });

  it("valor do boleto ≠ parcela: só avisa", () => {
    expect(avisoValorBoleto({ valor: 214.03 }, 214.03)).toBeNull();
    expect(avisoValorBoleto({ valor: null }, 10)).toBeNull();
    expect(avisoValorBoleto({ valor: 214.03 }, 200)?.replace(/ /g, " ")).toBe("O boleto é de R$ 214,03 e a parcela, de R$ 200,00: confira se é o boleto certo.");
  });
});

describe("o que a conta a pagar grava", () => {
  it("ausente = não mexe; vazio = tira; válido = linha + código de barras (só dígitos); inválido = erro", () => {
    expect(boletoParaGravar(undefined)).toEqual({ ok: true, dados: {} });
    expect(boletoParaGravar(null)).toEqual({ ok: true, dados: { linhaDigitavel: null, codigoBarrasBoleto: null } });
    expect(boletoParaGravar(" . ")).toEqual({ ok: true, dados: { linhaDigitavel: null, codigoBarrasBoleto: null } });
    expect(boletoParaGravar("10492.00650 61000.100042 00997.263900 9 89810000021403")).toEqual({ ok: true, dados: { linhaDigitavel: BANCARIO.linha, codigoBarrasBoleto: BANCARIO.barras } });
    expect(boletoParaGravar(BANCARIO.barras)).toEqual({ ok: true, dados: { linhaDigitavel: BANCARIO.linha, codigoBarrasBoleto: BANCARIO.barras } });
    expect(boletoParaGravar(trocar(BANCARIO.linha, 5, 1))).toEqual({ ok: false, erro: expect.stringMatching(/^Boleto: Dígito verificador não confere no campo 1/) });
  });
});
