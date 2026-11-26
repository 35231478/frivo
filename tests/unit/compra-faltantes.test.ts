/**
 * Orçamento, leva C — regras puras da "compra dos faltantes":
 *  - necessidade por produto (produtos + materiais; peça derivada uma vez só);
 *  - falta = necessidade − disponível (regra da leva B); sem controle de estoque não entra;
 *  - o que já está em pedido ABERTO deste orçamento sai do que falta pedir;
 *  - o plano idempotente: nada / acrescentar no "Solicitado" / criar com a diferença.
 */
import { describe, expect, it } from "vitest";
import {
  faltantesDoOrcamento, necessidadePorProduto, observacaoDeOrigem, orcamentoAceitaSolicitacao, planoDaSolicitacao,
  type PedidoAbertoResumo, type ProdutoEstoque,
} from "@/lib/orcamentos/compra-faltantes";

describe("necessidadePorProduto", () => {
  it("soma produtos e materiais por produto; a peça derivada (materialId) entra só pelo material; ignora sem produto e quantidade ≤ 0", () => {
    const m = necessidadePorProduto({
      produtos: [
        { produtoId: "cap", quantidade: 2 },
        { produtoId: "cap", quantidade: "1", materialId: "mat-1" }, // peça derivada: já vem pelo material
        { produtoId: "gas", quantidade: 3 },
        { produtoId: null, quantidade: 5 },
        { produtoId: "zero", quantidade: 0 },
      ],
      materiais: [{ produtoId: "cap", quantidade: 1 }, { produtoId: "tubo", quantidade: 2.5 }, { produtoId: "tubo", quantidade: 0.5 }, { produtoId: null, quantidade: 9 }],
    });
    expect(Object.fromEntries(m)).toEqual({ cap: 3, gas: 3, tubo: 3 });
  });
});

describe("faltantesDoOrcamento", () => {
  const P = (id: string, disponivel: number, controlaEstoque = true): ProdutoEstoque => ({ id, nome: `Produto ${id}`, unidade: "un", controlaEstoque, disponivel });
  const nec = new Map([["cap", 3], ["gas", 3], ["tubo", 5], ["livre", 9], ["exato", 4]]);
  it("só o que o estoque não cobre; disponível negativo conta; sem controle de estoque fica fora; cobre exatamente: fora", () => {
    const r = faltantesDoOrcamento(nec, [P("cap", -1), P("gas", 12), P("tubo", 2), P("livre", 0, false), P("exato", 4)], []);
    expect(r.map((f) => [f.produtoId, f.falta, f.solicitado, f.aSolicitar])).toEqual([["cap", 4, 0, 4], ["tubo", 3, 0, 3]]);
  });
  it("pedido aberto deste orçamento abate o que falta pedir; encerrado (cancelado/concluído) não conta", () => {
    const pedidos: PedidoAbertoResumo[] = [
      { id: "p1", numero: "PCI-1", status: "COTANDO", itens: [{ produtoId: "cap", quantidade: 1 }, { produtoId: "cap", quantidade: "1.5" }] },
      { id: "p2", numero: "PCI-2", status: "CANCELADO", itens: [{ produtoId: "tubo", quantidade: 99 }] },
      { id: "p3", numero: "PCI-3", status: "CONCLUIDO", itens: [{ produtoId: "tubo", quantidade: 99 }] },
    ];
    const r = faltantesDoOrcamento(nec, [P("cap", -1), P("tubo", 2)], pedidos);
    expect(r.find((f) => f.produtoId === "cap")).toMatchObject({ falta: 4, solicitado: 2.5, aSolicitar: 1.5, pedidos: [{ id: "p1", numero: "PCI-1", status: "COTANDO" }] });
    expect(r.find((f) => f.produtoId === "tubo")).toMatchObject({ solicitado: 0, aSolicitar: 3, pedidos: [] });
  });
  it("pedido além do que falta: a solicitar é 0 (nunca negativo)", () => {
    const r = faltantesDoOrcamento(new Map([["cap", 3]]), [P("cap", 0)], [{ id: "p1", numero: "PCI-1", status: "SOLICITADO", itens: [{ produtoId: "cap", quantidade: 10 }] }]);
    expect(r[0]).toMatchObject({ falta: 3, solicitado: 10, aSolicitar: 0 });
  });
});

describe("planoDaSolicitacao", () => {
  const F = (produtoId: string, aSolicitar: number, pedidos: { id: string; numero: string; status: string }[] = []) => ({
    produtoId, descricao: produtoId, unidade: "un", necessario: 5, disponivel: 0, falta: 5, solicitado: 5 - aSolicitar, aSolicitar, pedidos,
  });
  it("nada a pedir: 'nada' com os pedidos que já cobrem", () => {
    const p = planoDaSolicitacao([F("cap", 0, [{ id: "p1", numero: "PCI-1", status: "COTANDO" }])], []);
    expect(p).toEqual({ acao: "nada", pedidos: [{ id: "p1", numero: "PCI-1" }] });
  });
  it("há pedido deste orçamento ainda SOLICITADO: acrescenta nele (não duplica)", () => {
    const p = planoDaSolicitacao([F("cap", 2), F("tubo", 0)], [
      { id: "p9", numero: "PCI-9", status: "COTANDO", itens: [] }, { id: "p1", numero: "PCI-1", status: "SOLICITADO", itens: [] },
    ]);
    expect(p).toEqual({ acao: "acrescentar", pedidoId: "p1", itens: [{ produtoId: "cap", descricao: "cap", unidade: "un", quantidade: 2 }] });
  });
  it("todos os abertos já em cotação (ou nenhum): cria com a diferença", () => {
    expect(planoDaSolicitacao([F("cap", 2)], [{ id: "p9", numero: "PCI-9", status: "COTANDO", itens: [] }])).toMatchObject({ acao: "criar", itens: [{ produtoId: "cap", quantidade: 2 }] });
    expect(planoDaSolicitacao([F("cap", 2)], [])).toMatchObject({ acao: "criar" });
  });
});

describe("textos e status", () => {
  it("observação de origem e status que aceitam", () => {
    expect(observacaoDeOrigem("ORC-12")).toBe("Gerado do orçamento ORC-12: itens sem estoque suficiente.");
    expect(["RASCUNHO", "ENVIADO", "APROVADO", "CONVERTIDA"].map(orcamentoAceitaSolicitacao)).toEqual([true, true, true, true]);
    expect(["CANCELADO", "REPROVADO"].map(orcamentoAceitaSolicitacao)).toEqual([false, false]);
  });
});
