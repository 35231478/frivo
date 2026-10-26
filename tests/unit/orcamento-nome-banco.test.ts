/**
 * Regras puras: nome automático do orçamento (lib/orcamentos/nome.ts) e dados bancários da empresa
 * no documento (lib/orcamentos/dados-bancarios.ts).
 */
import { describe, expect, it } from "vitest";
import { NOME_MAX, nomeAutomaticoOrcamento, nomeFinalOrcamento, rotuloEquipamentoNome } from "@/lib/orcamentos/nome";
import { linhasDadosBancarios } from "@/lib/orcamentos/dados-bancarios";

describe("nome automático do orçamento", () => {
  it("da OS: tipo — equipamento principal — cliente · unidade", () => {
    expect(nomeAutomaticoOrcamento({ tipoOs: "Manutenção Corretiva", equipamento: "Samsung WindFree 18k", cliente: "Hospital Santa Clara", unidade: "Bloco A", itens: ["Troca de capacitor"] }))
      .toBe("Manutenção Corretiva — Samsung WindFree 18k — Hospital Santa Clara · Bloco A");
  });
  it("sem OS: o 1º item (+ quantos mais) — cliente", () => {
    expect(nomeAutomaticoOrcamento({ cliente: "Padaria Pão Quente", itens: ["Limpeza de split", "  ", "Capacitor 35uF", "Gás R410A"] })).toBe("Limpeza de split + 2 itens — Padaria Pão Quente");
    expect(nomeAutomaticoOrcamento({ cliente: "Padaria", itens: ["Limpeza de split", "Capacitor"] })).toBe("Limpeza de split + 1 item — Padaria");
    expect(nomeAutomaticoOrcamento({ cliente: "Padaria", itens: ["Limpeza de split"] })).toBe("Limpeza de split — Padaria");
  });
  it("sem nada: 'Orçamento' (+ cliente se houver); espaços e tamanho sob controle", () => {
    expect(nomeAutomaticoOrcamento({})).toBe("Orçamento");
    expect(nomeAutomaticoOrcamento({ cliente: "  Escola   Horizonte " })).toBe("Orçamento — Escola Horizonte");
    const longo = nomeAutomaticoOrcamento({ tipoOs: "X".repeat(80), equipamento: "Y".repeat(80), cliente: "Z".repeat(80), unidade: "W".repeat(80) });
    expect(longo.length).toBeLessThanOrEqual(NOME_MAX);
    expect(longo.endsWith("…")).toBe(true);
  });
  it("o nome digitado é sempre respeitado; vazio vira o automático", () => {
    expect(nomeFinalOrcamento("  Meu nome  ", { tipoOs: "Corretiva" })).toBe("Meu nome");
    expect(nomeFinalOrcamento("   ", { tipoOs: "Corretiva", cliente: "Hosp" })).toBe("Corretiva — Hosp");
    expect(nomeFinalOrcamento(null, {})).toBe("Orçamento");
  });
  it("rótulo do equipamento: apelido ou marca + modelo", () => {
    expect(rotuloEquipamentoNome({ nome: "Split Sala 1", marca: "LG", modelo: "X" })).toBe("Split Sala 1");
    expect(rotuloEquipamentoNome({ nome: null, marca: "LG", modelo: "Dual Inverter" })).toBe("LG Dual Inverter");
    expect(rotuloEquipamentoNome(null)).toBe("");
  });
});

describe("dados bancários no documento", () => {
  const base = { nome: "Clima Total Ltda", cnpj: "12345678000190" };
  it("sem banco/conta e sem PIX: nenhum bloco (nem campo vazio)", () => {
    expect(linhasDadosBancarios(base)).toBeNull();
    expect(linhasDadosBancarios({ ...base, bancoNome: "Inter", bancoConta: "  " })).toBeNull(); // banco sem conta não basta
    expect(linhasDadosBancarios({ ...base, bancoAgencia: "0001" })).toBeNull();
  });
  it("conta completa: banco, agência, conta (tipo), titular = razão social + CNPJ", () => {
    expect(linhasDadosBancarios({ ...base, bancoNome: "Banco Inter (077)", bancoAgencia: "0001", bancoConta: "12345-6", bancoTipoConta: "Corrente" }, (d) => `[${d}]`)).toEqual([
      { rotulo: "Banco", valor: "Banco Inter (077)" },
      { rotulo: "Agência", valor: "0001" },
      { rotulo: "Conta corrente", valor: "12345-6" },
      { rotulo: "Titular", valor: "Clima Total Ltda — CNPJ [12345678000190]" },
    ]);
  });
  it("só PIX: titular + chave; titular próprio quando informado", () => {
    expect(linhasDadosBancarios({ ...base, pixChave: " pix@clima.com ", bancoTitular: "Clima Total Serviços" })).toEqual([
      { rotulo: "Titular", valor: "Clima Total Serviços — CNPJ 12345678000190" },
      { rotulo: "Chave PIX", valor: "pix@clima.com" },
    ]);
  });
});
