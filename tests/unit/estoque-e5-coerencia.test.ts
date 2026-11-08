/**
 * Estoque E5 — coerência (fecha o módulo): a regra PURA que os três caminhos de cobrança compartilham.
 *  - faturaDaOs: item PRODUTO da OS (a peça) vira linha de produto; o serviço sai já ajustado pelos materiais inclusos
 *    (que nunca viram linha nem levam custo);
 *  - linhasMedicaoCompleta (medição + relatório): o serviço do período numa linha e as peças como produto, somando o
 *    valor do relatório ao centavo; sem peça, uma linha só (idêntico ao de antes);
 *  - os dois produzem as MESMAS peças e o MESMO total para a mesma OS.
 */
import { describe, expect, it } from "vitest";
import { faturaDaOs, linhasMedicaoCompleta } from "@/lib/faturamento/fatura";

// A OS da E3.3b: serviço 800 + ajuste dos inclusos 40 = 840 (o tubo não é item), peça Capacitor 80 (item PRODUTO derivado)
const ITENS = [
  { descricao: "Instalação split", quantidade: 1, valorUnitario: 840, valorTotal: 840, servicoId: "sInst", tipo: "SERVICO", produtoId: null },
  { descricao: "Capacitor 35uF", quantidade: 1, valorUnitario: 80, valorTotal: 80, servicoId: null, tipo: "PRODUTO", produtoId: "cap" },
];

describe("E5 — coerência material/peça nos caminhos de cobrança (regra pura)", () => {
  it("faturaDaOs: a peça sai como PRODUTO com o produto do catálogo; o serviço já ajustado; nenhuma linha de material incluso nem custo", () => {
    const f = faturaDaOs("os1", ITENS, []);
    expect(f.linhas).toEqual([
      { tipo: "SERVICO", descricao: "Instalação split", quantidade: 1, valorUnitario: 840, valorTotal: 840, servicoId: "sInst", ordemServicoId: "os1" },
      { tipo: "PRODUTO", descricao: "Capacitor 35uF", quantidade: 1, valorUnitario: 80, valorTotal: 80, produtoId: "cap", ordemServicoId: "os1" },
    ]);
    expect(f.valorTotal).toBe(920);
    expect(JSON.stringify(f)).not.toMatch(/custo|material|tubo/i);
    // Item antigo (sem tipo) continua serviço
    expect(faturaDaOs("os1", [{ descricao: "Antigo", quantidade: 1, valorUnitario: 10, valorTotal: 10 }], []).linhas[0]).toMatchObject({ tipo: "SERVICO", servicoId: null });
  });

  it("linhasMedicaoCompleta: sem peça = uma linha de serviço (idêntico ao de antes); com peça = serviço do período + produto, somando o valor do relatório", () => {
    expect(linhasMedicaoCompleta("REL-7", 840, "os1", [])).toEqual([
      { tipo: "SERVICO", descricao: "Serviço do período — REL-7", quantidade: 1, valorUnitario: 840, valorTotal: 840, ordemServicoId: "os1" },
    ]);
    const com = linhasMedicaoCompleta("REL-7", 920, "os1", [{ descricao: "Capacitor 35uF", quantidade: 1, valorUnitario: 80, valorTotal: 80, produtoId: "cap" }]);
    expect(com).toEqual([
      { tipo: "SERVICO", descricao: "Serviço do período — REL-7", quantidade: 1, valorUnitario: 840, valorTotal: 840, ordemServicoId: "os1" },
      { tipo: "PRODUTO", descricao: "Capacitor 35uF", quantidade: 1, valorUnitario: 80, valorTotal: 80, produtoId: "cap", ordemServicoId: "os1" },
    ]);
    expect(com.reduce((s, l) => s + l.valorTotal, 0)).toBe(920);
    // Centavos: 100,10 com peças 33,37 → serviço 66,73
    const cent = linhasMedicaoCompleta("REL-1", "100.10", "os1", [{ descricao: "A", quantidade: 1, valorUnitario: "33.37", valorTotal: "33.37" }]);
    expect(cent.map((l) => l.valorTotal)).toEqual([66.73, 33.37]);
    // Só peças (o relatório vale exatamente as peças): nenhuma linha de serviço a zero
    expect(linhasMedicaoCompleta("REL-2", 80, "os1", [{ descricao: "Cap", quantidade: 2, valorUnitario: 40, valorTotal: 80, produtoId: "cap" }]).map((l) => l.tipo)).toEqual(["PRODUTO"]);
    // Valor do relatório menor que as peças (dado antigo inconsistente): o serviço não fica negativo
    expect(linhasMedicaoCompleta("REL-3", 50, "os1", [{ descricao: "Cap", quantidade: 1, valorUnitario: 80, valorTotal: 80 }]).map((l) => [l.tipo, l.valorTotal])).toEqual([["PRODUTO", 80]]);
    expect(JSON.stringify(com)).not.toMatch(/custo|material/i);
  });

  it("os dois caminhos concordam: mesmas peças (descrição, quantidade, valor, produto) e mesmo total para a mesma OS", () => {
    const fat = faturaDaOs("os1", ITENS, []);
    const med = linhasMedicaoCompleta("REL-7", fat.valorTotal, "os1", ITENS.filter((i) => i.tipo === "PRODUTO"));
    const pecas = (ls: { tipo: string; descricao: string; quantidade: number; valorTotal: number; produtoId?: string | null }[]) =>
      ls.filter((l) => l.tipo === "PRODUTO").map((l) => [l.descricao, l.quantidade, l.valorTotal, l.produtoId]);
    expect(pecas(med)).toEqual(pecas(fat.linhas));
    expect(med.reduce((s, l) => s + l.valorTotal, 0)).toBe(fat.valorTotal);
    expect(med.filter((l) => l.tipo === "SERVICO").reduce((s, l) => s + l.valorTotal, 0)).toBe(fat.linhas.filter((l) => l.tipo === "SERVICO").reduce((s, l) => s + l.valorTotal, 0));
  });
});
