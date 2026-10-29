/**
 * "Gerar OS" a partir do orçamento aprovado — regras puras: quando pode gerar, como os itens do
 * orçamento viram itens da OS (serviços e depois produtos, na ordem, mesmos valores) e a descrição.
 */
import { describe, expect, it } from "vitest";
import { descricaoDaOs, itensParaOs, motivoNaoGerarOs } from "@/lib/orcamentos/gerar-os";

describe("motivoNaoGerarOs", () => {
  it("só orçamento COMUM aprovado gera OS", () => {
    expect(motivoNaoGerarOs({ status: "APROVADO", tipo: "COMUM" })).toBeNull();
    for (const status of ["RASCUNHO", "ENVIADO", "REPROVADO", "CANCELADO", "CONVERTIDA"]) {
      expect(motivoNaoGerarOs({ status, tipo: "COMUM" })).toBe("Disponível apenas para orçamento aprovado.");
    }
  });
  it("proposta de contrato nunca gera OS avulsa, nem aprovada", () => {
    expect(motivoNaoGerarOs({ status: "APROVADO", tipo: "PROPOSTA_CONTRATO" })).toBe("Proposta de contrato não gera OS avulsa: as OS saem do contrato.");
    expect(motivoNaoGerarOs({ status: "RASCUNHO", tipo: "PROPOSTA_CONTRATO" })).toContain("Proposta de contrato");
  });
});

describe("itensParaOs", () => {
  const dec = (v: number) => ({ toString: () => String(v), valueOf: () => v }); // Decimal do Prisma
  it("serviços e depois produtos, cada grupo na ordem do orçamento, valores em número", () => {
    const itens = itensParaOs(
      [
        { descricao: "Mão de obra", quantidade: dec(1), valorUnitario: dec(600), valorTotal: dec(600), ordem: 2 },
        { descricao: "  Diagnóstico  ", quantidade: dec(2), valorUnitario: dec(90), valorTotal: dec(180), ordem: 0 },
      ],
      [
        { descricao: "Gás", quantidade: dec(1.5), valorUnitario: dec(100), valorTotal: dec(150), ordem: 1 },
        { descricao: "Compressor", quantidade: dec(1), valorUnitario: dec(900), valorTotal: dec(900), ordem: 0 },
      ],
    );
    expect(itens).toEqual([
      { descricao: "Diagnóstico", quantidade: 2, valorUnitario: 90, valorTotal: 180 },
      { descricao: "Mão de obra", quantidade: 1, valorUnitario: 600, valorTotal: 600 },
      { descricao: "Compressor", quantidade: 1, valorUnitario: 900, valorTotal: 900 },
      { descricao: "Gás", quantidade: 1.5, valorUnitario: 100, valorTotal: 150 },
    ]);
  });
  it("sem ordem vale 0; não altera as listas de entrada; descrição longa é cortada em 500", () => {
    const servicos = [{ descricao: "B", quantidade: "1", valorUnitario: "10", valorTotal: "10", ordem: 1 }, { descricao: "A", quantidade: "1", valorUnitario: "5", valorTotal: "5", ordem: null }];
    const copia = JSON.stringify(servicos);
    expect(itensParaOs(servicos, []).map((i) => i.descricao)).toEqual(["A", "B"]);
    expect(JSON.stringify(servicos)).toBe(copia);
    expect(itensParaOs([], [{ descricao: "x".repeat(600), quantidade: 1, valorUnitario: 1, valorTotal: 1 }])[0].descricao).toHaveLength(500);
    expect(itensParaOs([], [])).toEqual([]);
  });
});

describe("descricaoDaOs", () => {
  it("nome do orçamento com o código e, se houver, o resumo", () => {
    expect(descricaoDaOs({ codigo: "ORC-0007", nome: "Troca de compressor", descricao: "  Split da recepção.  " })).toBe("Troca de compressor (orçamento ORC-0007)\n\nSplit da recepção.");
    expect(descricaoDaOs({ codigo: "ORC-0007", nome: "Troca de compressor", descricao: "   " })).toBe("Troca de compressor (orçamento ORC-0007)");
    expect(descricaoDaOs({ codigo: "ORC-0007", nome: "  ", descricao: null })).toBe("Serviço (orçamento ORC-0007)");
    expect(descricaoDaOs({ codigo: "ORC-1", nome: "N", descricao: "y".repeat(5000) })).toHaveLength(4000);
  });
});
