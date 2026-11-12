/**
 * Estoque E3.3b — materiais e peças na OS sem orçamento: a REGRA PURA. Prova:
 *  - prepararItemOs: serviço com materiais vale base + ajuste (a mesma regra da E3.3, lib/orcamentos/materiais); o kit
 *    já chega explodido; peça vira item PRODUTO derivado (com o índice do material); manual vale; produto nunca leva
 *    materiais; linha livre/sem materiais = unitário × quantidade (o total informado manda quando veio);
 *  - itensParaOs (OS gerada do orçamento): os MESMOS valores de antes + tipo, catálogo, snapshot copiado e o id de
 *    origem da peça derivada;
 *  - faturaDaOs: item PRODUTO vira linha de produto (produtoId); item antigo (sem tipo) continua serviço.
 */
import { describe, expect, it } from "vitest";
import { prepararItemOs, unitarioParaEdicao } from "@/lib/os/materiais";
import { itensParaOs } from "@/lib/orcamentos/gerar-os";
import { faturaDaOs } from "@/lib/faturamento/fatura";
import type { MaterialOrcamento } from "@/lib/orcamentos/materiais";

const m = (produtoId: string, descricao: string, quantidade: number, quantidadePadrao: number, venda: number, comportamento: MaterialOrcamento["comportamento"], origem: MaterialOrcamento["origem"] = "SOLTO", custoUnit: number | null = null): MaterialOrcamento =>
  ({ produtoId, descricao, unidade: "un", comportamento, quantidade, quantidadePadrao, valorVendaUnit: venda, custoUnit, origem, kitNome: origem === "KIT" ? "Kit instalação" : null });
// Tubo 3→5 (+40), filtro 1→3 (+70), suporte 1→10 (+540) = +650; capacitor 1→2 = peça 160 à parte
const MATERIAIS = [m("tubo", "Tubo", 5, 3, 20, "INCLUSO_NO_SERVICO", "KIT", 12), m("filtro", "Filtro secador", 3, 1, 35, "INCLUSO_NO_SERVICO", "KIT", 20), m("suporte", "Suporte", 10, 1, 60, "INCLUSO_NO_SERVICO"), m("cap", "Capacitor 35uF", 2, 1, 80, "VENDA_A_PARTE", "SOLTO", 45)];

describe("prepararItemOs", () => {
  it("serviço com materiais: base + ajuste (+650), unitário efetivo, snapshot com ordem, peça como PRODUTO derivado", () => {
    const p = prepararItemOs({ tipo: "SERVICO", servicoId: "s1", descricao: " Instalação split ", quantidade: 1, valorUnitario: 800, materiais: MATERIAIS });
    expect(p).toMatchObject({ tipo: "SERVICO", servicoId: "s1", produtoId: null, descricao: "Instalação split", quantidade: 1, valorBase: 800, ajusteMateriais: 650, valorManual: false, valorTotal: 1450, valorUnitario: 1450 });
    expect(p.materiais.map((x) => [x.produtoId, x.quantidade, x.quantidadePadrao, x.ordem])).toEqual([["tubo", 5, 3, 0], ["filtro", 3, 1, 1], ["suporte", 10, 1, 2], ["cap", 2, 1, 3]]);
    expect(p.pecas).toEqual([{ idxMaterial: 3, produtoId: "cap", descricao: "Capacitor 35uF", quantidade: 2, valorUnitario: 80, valorTotal: 160 }]);
    // Quantidade 2 do serviço: a base é unitário × qtd; o ajuste não escala (snapshot por linha)
    expect(prepararItemOs({ descricao: "X", quantidade: 2, valorUnitario: 800, materiais: MATERIAIS })).toMatchObject({ valorBase: 1600, valorTotal: 2250, valorUnitario: 1125 });
  });

  it("manual vale; peça com quantidade 0 não vira item; produto nunca leva materiais; linha livre = unitário × qtd (ou o total informado)", () => {
    expect(prepararItemOs({ descricao: "X", quantidade: 1, valorUnitario: 800, valorTotal: 1000, valorManual: true, materiais: MATERIAIS })).toMatchObject({ valorManual: true, valorTotal: 1000, valorUnitario: 1000, ajusteMateriais: 650 });
    expect(prepararItemOs({ descricao: "X", quantidade: 1, valorUnitario: 800, materiais: MATERIAIS.map((x) => (x.produtoId === "cap" ? { ...x, quantidade: 0 } : x)) }).pecas).toEqual([]);
    const prod = prepararItemOs({ tipo: "PRODUTO", produtoId: "cap", servicoId: "s1", descricao: "Capacitor", quantidade: 2, valorUnitario: 35.5, materiais: MATERIAIS });
    expect(prod).toMatchObject({ tipo: "PRODUTO", produtoId: "cap", servicoId: null, valorTotal: 71, valorUnitario: 35.5, valorBase: null, ajusteMateriais: 0, materiais: [], pecas: [] });
    expect(prepararItemOs({ descricao: "Livre", quantidade: 3, valorUnitario: 33.33 })).toMatchObject({ tipo: "SERVICO", valorTotal: 99.99, valorUnitario: 33.33, valorBase: null, materiais: [] });
    expect(prepararItemOs({ descricao: "Livre", quantidade: 3, valorUnitario: 33.33, valorTotal: 100 })).toMatchObject({ valorTotal: 100, valorUnitario: 33.33 });
    expect(prepararItemOs({ descricao: "Livre", quantidade: 1, valorUnitario: 0, materiais: [] }).valorTotal).toBe(0);
  });

  it("unitário para edição: com materiais é o BASE (valorBase ÷ qtd); sem, o gravado", () => {
    expect(unitarioParaEdicao({ quantidade: 2, valorUnitario: 1125, valorBase: 1600, materiais: [{}] })).toBe(800);
    expect(unitarioParaEdicao({ quantidade: 2, valorUnitario: 1125, valorBase: 1600, materiais: [] })).toBe(1125);
    expect(unitarioParaEdicao({ quantidade: 1, valorUnitario: 33.33, valorBase: null })).toBe(33.33);
  });
});

describe("OS gerada do orçamento (itensParaOs) carrega tipo, catálogo e o snapshot, com os mesmos valores", () => {
  it("serviço ajustado + peça derivada apontando para o material de origem", () => {
    const itens = itensParaOs(
      [{ id: "os1", servicoId: "sInst", descricao: "Instalação", quantidade: 1, valorUnitario: 840, valorTotal: 840, ordem: 0, valorBase: 800, ajusteMateriais: 40, valorManual: false,
        materiais: [{ id: "mOrc1", produtoId: "tubo", descricao: "Tubo", unidade: "m", comportamento: "INCLUSO_NO_SERVICO", quantidade: 5, quantidadePadrao: 3, valorVendaUnit: 20, custoUnit: 12, origem: "KIT", kitNome: "Kit", ordem: 0 },
          { id: "mOrc2", produtoId: "cap", descricao: "Capacitor", unidade: "un", comportamento: "VENDA_A_PARTE", quantidade: 1, quantidadePadrao: 1, valorVendaUnit: 80, custoUnit: null, origem: "SOLTO", kitNome: null, ordem: 1 }] }],
      [{ produtoId: "fita", descricao: "Fita", quantidade: 1, valorUnitario: 15, valorTotal: 15, ordem: 0 }, { produtoId: "cap", descricao: "Capacitor", quantidade: 1, valorUnitario: 80, valorTotal: 80, ordem: 1, materialId: "mOrc2" }],
    );
    expect(itens.map((i) => [i.tipo, i.descricao, i.valorTotal, i.orcamentoServicoId, i.servicoId, i.produtoId, i.materialOrigemId])).toEqual([
      ["SERVICO", "Instalação", 840, "os1", "sInst", null, null], ["PRODUTO", "Fita", 15, null, null, "fita", null], ["PRODUTO", "Capacitor", 80, null, null, "cap", "mOrc2"],
    ]);
    expect(itens[0]).toMatchObject({ valorBase: 800, ajusteMateriais: 40, valorManual: false });
    expect(itens[0].materiais.map((x) => [x.origemId, x.produtoId, x.quantidade, x.quantidadePadrao, x.custoUnit, x.ordem])).toEqual([["mOrc1", "tubo", 5, 3, 12, 0], ["mOrc2", "cap", 1, 1, null, 1]]);
    expect(itens[1].materiais).toEqual([]);
    // Orçamento antigo (sem nada disso): serviço sem catálogo, sem base, sem materiais — como antes
    const antigo = itensParaOs([{ id: "o", descricao: "Mão de obra", quantidade: 1, valorUnitario: 600, valorTotal: 600 }], []);
    expect(antigo[0]).toMatchObject({ tipo: "SERVICO", servicoId: null, valorBase: null, ajusteMateriais: 0, valorManual: false, materiais: [], materialOrigemId: null, orcamentoServicoId: "o", valorTotal: 600 });
  });
});

describe("faturaDaOs: a peça é linha de PRODUTO; item antigo continua serviço", () => {
  it("tipo e catálogo por item; total = soma", () => {
    const f = faturaDaOs("os1", [
      { descricao: "Instalação", quantidade: 1, valorUnitario: 840, valorTotal: 840, servicoId: "sInst", tipo: "SERVICO" },
      { descricao: "Capacitor", quantidade: 2, valorUnitario: 80, valorTotal: 160, tipo: "PRODUTO", produtoId: "cap" },
      { descricao: "Item antigo", quantidade: 1, valorUnitario: 100, valorTotal: 100 },
    ], [{ descricao: "Içamento", valor: 50 }]);
    expect(f.linhas.map((l) => [l.tipo, l.descricao, l.servicoId ?? null, l.produtoId ?? null, l.valorTotal])).toEqual([
      ["SERVICO", "Instalação", "sInst", null, 840], ["PRODUTO", "Capacitor", null, "cap", 160], ["SERVICO", "Item antigo", null, null, 100], ["SERVICO", "Serviço adicional — Içamento", null, null, 50],
    ]);
    expect(f.valorLiquido).toBe(1150);
    expect(JSON.stringify(f)).not.toMatch(/custo|material/i);
  });
});
