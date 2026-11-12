/**
 * Regras puras: nome automático do orçamento (lib/orcamentos/nome.ts) e dados bancários da empresa
 * no documento (lib/orcamentos/dados-bancarios.ts).
 */
import { describe, expect, it } from "vitest";
import { cortarTexto, NOME_AUTO_MAX, NOME_MAX, nomeAutomaticoOrcamento, nomeFinalOrcamento, rotuloEquipamentoNome } from "@/lib/orcamentos/nome";
import { linhasDadosBancarios } from "@/lib/orcamentos/dados-bancarios";

describe("nome automático do orçamento (curto: o quê — cliente)", () => {
  it("da OS: tipo — cliente (equipamento e unidade não entram mais: deixavam o nome em 2 linhas)", () => {
    expect(nomeAutomaticoOrcamento({ tipoOs: "Manutenção Corretiva", equipamento: "Samsung WindFree 18k", cliente: "Hospital Santa Clara", unidade: "Bloco A", itens: ["Troca de capacitor"] }))
      .toBe("Manutenção Corretiva — Hospital Santa Clara");
  });
  it("sem OS: o 1º item (+N) — cliente", () => {
    expect(nomeAutomaticoOrcamento({ cliente: "Padaria Pão Quente", itens: ["Limpeza de split", "  ", "Capacitor 35uF", "Gás R410A"] })).toBe("Limpeza de split +2 — Padaria Pão Quente");
    expect(nomeAutomaticoOrcamento({ cliente: "Padaria", itens: ["Limpeza de split", "Capacitor"] })).toBe("Limpeza de split +1 — Padaria");
    expect(nomeAutomaticoOrcamento({ cliente: "Padaria", itens: ["Limpeza de split"] })).toBe("Limpeza de split — Padaria");
  });
  it("descrição longa de item é cortada na palavra, com reticências", () => {
    const n = nomeAutomaticoOrcamento({ cliente: "Hospital Santa Clara", itens: ["Instalação de condensadora com suporte de piso e interligação elétrica completa", "Gás"] });
    expect(n).toBe("Instalação de condensadora com… +1 — Hospital Santa Clara");
    expect(n.length).toBeLessThanOrEqual(NOME_AUTO_MAX);
  });
  it("sem nada: 'Orçamento' (+ cliente se houver); nunca passa do teto", () => {
    expect(nomeAutomaticoOrcamento({})).toBe("Orçamento");
    expect(nomeAutomaticoOrcamento({ cliente: "  Escola   Horizonte " })).toBe("Orçamento — Escola Horizonte");
    const longo = nomeAutomaticoOrcamento({ tipoOs: "Manutenção Preventiva Programada Mensal do Sistema Central", cliente: "Associação Beneficente Hospitalar Santa Casa de Misericórdia" });
    expect(longo.length).toBeLessThanOrEqual(NOME_AUTO_MAX);
    expect(longo).toBe("Manutenção Preventiva Programada… — Associação Beneficente…");
    const semEspaco = nomeAutomaticoOrcamento({ tipoOs: "X".repeat(80), cliente: "Z".repeat(80) });
    expect(semEspaco.length).toBeLessThanOrEqual(NOME_AUTO_MAX);
    expect(semEspaco.endsWith("…")).toBe(true);
  });
  it("cortarTexto: na palavra quando dá, sem pontuação pendurada; curto fica igual", () => {
    expect(cortarTexto("Limpeza de split", 30)).toBe("Limpeza de split");
    expect(cortarTexto("  a   b  ", 30)).toBe("a b");
    expect(cortarTexto("Troca de capacitor, gás e limpeza", 22)).toBe("Troca de capacitor…");
    expect(cortarTexto("Abcdefghijklmnopqrstuvwxyz", 10)).toBe("Abcdefghi…");
    expect(cortarTexto(null, 10)).toBe("");
  });
  it("o nome digitado é sempre respeitado; vazio vira o automático", () => {
    expect(nomeFinalOrcamento("  Meu nome  ", { tipoOs: "Corretiva" })).toBe("Meu nome");
    expect(nomeFinalOrcamento("   ", { tipoOs: "Corretiva", cliente: "Hosp" })).toBe("Corretiva — Hosp");
    expect(nomeFinalOrcamento(null, {})).toBe("Orçamento");
    expect(nomeFinalOrcamento("x".repeat(150), {}).length).toBe(150); // digitado longo não é cortado pelo teto do automático
    expect(NOME_MAX).toBe(120);
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
  it("conta completa: banco, agência, conta (tipo) à esquerda; titular (razão social) e CNPJ à direita", () => {
    expect(linhasDadosBancarios({ ...base, bancoNome: "Banco Inter (077)", bancoAgencia: "0001", bancoConta: "12345-6", bancoTipoConta: "Corrente" }, (d) => `[${d}]`)).toEqual([
      { rotulo: "Banco", valor: "Banco Inter (077)", coluna: "conta" },
      { rotulo: "Agência", valor: "0001", coluna: "conta" },
      { rotulo: "Conta corrente", valor: "12345-6", coluna: "conta" },
      { rotulo: "Titular", valor: "Clima Total Ltda", coluna: "favorecido" },
      { rotulo: "CNPJ", valor: "[12345678000190]", coluna: "favorecido" },
    ]);
    expect(linhasDadosBancarios({ ...base, bancoNome: "Inter", bancoConta: "1" })!.map((l) => l.rotulo)).toEqual(["Banco", "Conta", "Titular", "CNPJ"]);
  });
  it("só PIX: titular, CNPJ e chave; titular próprio quando informado", () => {
    expect(linhasDadosBancarios({ ...base, pixChave: " pix@clima.com ", bancoTitular: "Clima Total Serviços" })).toEqual([
      { rotulo: "Titular", valor: "Clima Total Serviços", coluna: "favorecido" },
      { rotulo: "CNPJ", valor: "12345678000190", coluna: "favorecido" },
      { rotulo: "Chave PIX", valor: "pix@clima.com", coluna: "favorecido" },
    ]);
  });
});
