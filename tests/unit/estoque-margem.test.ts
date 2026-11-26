/**
 * Orçamento, leva B — regras puras de estoque e margem (lib/orcamentos/estoque-margem):
 *  - falta no estoque (mesma regra do Estoque: o saldo já é líquido das reservas);
 *  - custo, lucro e margem da linha e do orçamento (margem sobre a venda, como no Estoque);
 *  - o que entra no resumo (peça derivada não conta duas vezes; sem custo fica fora e é contado);
 *  - segurança: o custo some (a CHAVE some) do que vai a quem não tem a permissão; o salvar nunca confia no navegador.
 */
import { describe, expect, it } from "vitest";
import {
  custoConfiavel, custosDoOrcamento, faltaNoEstoque, MARGEM_APERTADA, margemDoItem, resumoMargem,
  semCustoNosMateriais, semCustoNosServicos, tomDaMargem,
} from "@/lib/orcamentos/estoque-margem";

describe("faltaNoEstoque", () => {
  it("0 quando cobre (inclusive exatamente igual); a diferença quando não cobre", () => {
    expect(faltaNoEstoque(4, 4)).toBe(0);
    expect(faltaNoEstoque(3, 4)).toBe(0);
    expect(faltaNoEstoque(5, 4)).toBe(1);
    expect(faltaNoEstoque("2", -1)).toBe(3); // saldo negativo (reservado além do que há): falta tudo + o buraco
    expect(faltaNoEstoque(0.3, 0.1)).toBe(0.2); // sem lixo de ponto flutuante
  });
  it("sem dado de estoque (Estoque desligado ou produto sem controle): null, nunca 'falta'", () => {
    expect(faltaNoEstoque(10, null)).toBeNull();
    expect(faltaNoEstoque(10, undefined)).toBeNull();
  });
  it("quantidade inválida conta como 0", () => {
    expect(faltaNoEstoque("abc", 2)).toBe(0);
    expect(faltaNoEstoque(undefined, -2)).toBe(2);
  });
});

describe("margemDoItem", () => {
  it("custo = unitário × quantidade; lucro = venda − custo; margem sobre a venda", () => {
    expect(margemDoItem(359.6, 38.5, 4)).toEqual({ custo: 154, lucro: 205.6, margem: (205.6 / 359.6) * 100 });
    expect(margemDoItem(100, 30, 2)).toEqual({ custo: 60, lucro: 40, margem: 40 });
  });
  it("prejuízo: lucro e margem negativos", () => {
    const m = margemDoItem(50, 30, 2)!;
    expect(m.lucro).toBe(-10);
    expect(m.margem).toBe(-20);
  });
  it("sem custo: null (não inventa custo zero)", () => {
    expect(margemDoItem(100, null, 1)).toBeNull();
    expect(margemDoItem(100, undefined, 1)).toBeNull();
    expect(margemDoItem(100, Number.NaN, 1)).toBeNull();
  });
  it("venda zero: margem null (não divide por zero)", () => {
    expect(margemDoItem(0, 10, 1)).toEqual({ custo: 10, lucro: -10, margem: null });
  });
});

describe("resumoMargem", () => {
  it("soma os custos conhecidos, conta os desconhecidos à parte e calcula sobre o total sem ISS", () => {
    const r = resumoMargem(1000, [100, null, 250.5, undefined]);
    expect(r).toEqual({ venda: 1000, custo: 350.5, lucro: 649.5, margem: 64.95, semCusto: 2 });
  });
  it("sem itens: custo 0, margem 100%", () => {
    expect(resumoMargem(200, [])).toMatchObject({ custo: 0, lucro: 200, margem: 100, semCusto: 0 });
  });
  it("total zero: margem null", () => {
    expect(resumoMargem(0, [10]).margem).toBeNull();
  });
});

describe("custosDoOrcamento", () => {
  const custo = (id: string) => ({ a: 10, b: null as number | null }[id] ?? undefined);
  it("um custo por material (com quantidade) e por produto digitado; a peça derivada NÃO entra de novo", () => {
    const r = custosDoOrcamento({
      servicos: [
        { materiais: [{ custoUnit: 5, quantidade: 3 }, { custoUnit: null, quantidade: 1 }, { custoUnit: 7, quantidade: 0 }] },
        { materiais: null },
        {},
      ],
      produtos: [
        { catalogoId: "a", quantidade: 2 },
        { catalogoId: "b", quantidade: 1 },          // nunca comprado com custo
        { catalogoId: null, quantidade: 1 },         // digitado à mão
        { catalogoId: "a", quantidade: 4, derivada: true }, // peça: já veio pelo material
        { catalogoId: "a", quantidade: 0 },          // sem quantidade: fora
      ],
    }, custo);
    expect(r).toEqual([15, null, 20, null, null]);
  });
  it("produto que a rota não devolveu (outra empresa): sem custo", () => {
    expect(custosDoOrcamento({ servicos: [], produtos: [{ catalogoId: "zzz", quantidade: 1 }] }, custo)).toEqual([null]);
  });
});

describe("tomDaMargem", () => {
  it("negativa = atrasado; até o limite = atenção; acima = ok; sem margem = neutro", () => {
    expect(tomDaMargem(-0.1)).toBe("atrasado");
    expect(tomDaMargem(0)).toBe("atencao");
    expect(tomDaMargem(MARGEM_APERTADA)).toBe("atencao");
    expect(tomDaMargem(MARGEM_APERTADA + 0.1)).toBe("ok");
    expect(tomDaMargem(null)).toBe("neutro");
    expect(tomDaMargem(Number.NaN)).toBe("neutro");
  });
});

describe("segurança: o custo não sai sem a permissão", () => {
  it("semCustoNosMateriais tira a CHAVE (não vira null) e mantém o resto", () => {
    const [m] = semCustoNosMateriais([{ id: "1", descricao: "Tubo", custoUnit: 12, valorVendaUnit: 20 }]);
    expect(m).toEqual({ id: "1", descricao: "Tubo", valorVendaUnit: 20 });
    expect("custoUnit" in m).toBe(false);
    expect(JSON.stringify(semCustoNosMateriais([{ custoUnit: null }]))).toBe("[{}]");
  });
  it("semCustoNosServicos tira de todos os materiais de todas as linhas; linha sem materiais fica igual", () => {
    const linhas = [
      { descricao: "Instalação", materiais: [{ custoUnit: 12 }, { custoUnit: null, produtoId: "p" }] },
      { descricao: "Limpeza", materiais: null },
      { descricao: "Visita" },
    ];
    const r = semCustoNosServicos(linhas);
    expect(JSON.stringify(r)).not.toContain("custoUnit");
    expect(r[0].materiais).toEqual([{}, { produtoId: "p" }]);
    expect(r[1]).toBe(linhas[1]);
    expect(r[2]).toBe(linhas[2]);
    expect(linhas[0].materiais![0]).toEqual({ custoUnit: 12 }); // não mexe no original
  });

  it("custoConfiavel: gravado (mesmo id e produto) mantém; produto novo pega o último custo; sem produto, null", () => {
    const gravados = new Map([["m1", { produtoId: "p1", custoUnit: 12 }], ["m2", { produtoId: "p2", custoUnit: null }], ["m3", { produtoId: null, custoUnit: 4 }]]);
    const ultimos = new Map([["p1", 30], ["p3", 8]]);
    expect(custoConfiavel({ id: "m1", produtoId: "p1" }, gravados, ultimos)).toBe(12);  // não sobe para 30
    expect(custoConfiavel({ id: "m2", produtoId: "p2" }, gravados, ultimos)).toBeNull(); // gravado sem custo segue sem
    expect(custoConfiavel({ id: "m3", produtoId: null }, gravados, ultimos)).toBe(4);    // linha à mão já gravada
    expect(custoConfiavel({ id: "m1", produtoId: "p3" }, gravados, ultimos)).toBe(8);   // trocou o produto: custo do novo
    expect(custoConfiavel({ id: "x", produtoId: "p1" }, gravados, ultimos)).toBe(30);   // id desconhecido = novo
    expect(custoConfiavel({ produtoId: "p9" }, gravados, ultimos)).toBeNull();          // nunca comprado
    expect(custoConfiavel({ produtoId: null }, gravados, ultimos)).toBeNull();
  });
  it("custoConfiavel ignora qualquer custo vindo do navegador (nem é parâmetro)", () => {
    expect(custoConfiavel({ id: "m1", produtoId: "p1", custoUnit: 999 } as any, new Map([["m1", { produtoId: "p1", custoUnit: 12 }]]), new Map())).toBe(12);
  });
});

describe("podeVerCustoDeCompra (regra única do custo de compra)", () => {
  it("Estoque › visualizar OU Orçamentos › ver custo; mais nada abre o custo", async () => {
    const { podeVerCustoDeCompra } = await import("@/lib/estoque/custo-acesso");
    const com = (...ok: string[]) => (m: string, a: string) => ok.includes(`${m}.${a}`);
    expect(podeVerCustoDeCompra(com("estoque.visualizar"))).toBe(true);
    expect(podeVerCustoDeCompra(com("orcamentos.verCusto"))).toBe(true);
    expect(podeVerCustoDeCompra(com())).toBe(false);
    expect(podeVerCustoDeCompra(com("orcamentos.editar", "configuracoes.gerenciar", "ordens.editar", "estoque.separar", "compras.visualizar"))).toBe(false);
  });
});
