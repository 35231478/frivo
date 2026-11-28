/**
 * Leva I.2 — grupo B, regras puras:
 *  5. trava de preço de tabela na medição/fatura: as linhas da medição viram a conferência do orçamento/OS (a mesma
 *     regra: o preço da tabela passa, o diferente pede permissão e motivo, o já gravado não pede de novo); na tela, a
 *     marcação da tabela ao abrir/trocar o cliente e o "pede motivo";
 *  6. reajuste em massa da tabela de preço: % e R$, todos ou os escolhidos, centavos, desconto % → valor fixo, preço
 *     negativo recusado, a validação do pedido e do motivo; desfazer só os itens que estão como o lote deixou.
 */
import { describe, expect, it } from "vitest";
import {
  alteracoesDePrecoDeTabela, chaveCatalogo, conferirPrecoDeTabela, itensComPrecoDeTabelaAlterado, itensDaMedicaoParaTrava, marcarItensDaTabela, type ItemDaTela,
} from "@/lib/precos/trava-tabela";
import {
  avisoDosIgnorados, centavos, erroDoPedido, planoDeDesfazer, precoReajustado, previaDoReajuste, textoDoReajuste, type ItemDaTabela,
} from "@/lib/precos/reajuste-tabela";

describe("5. medição/fatura — a mesma trava do orçamento e da OS", () => {
  const tabela = new Map([[chaveCatalogo("servico", "sLimp"), 150], [chaveCatalogo("produto", "pFiltro"), 80]]);
  const linhas = (sv: number, pr = 80) => itensDaMedicaoParaTrava([
    { tipo: "SERVICO", servicoId: "sLimp", descricao: "Limpeza", valorUnitario: sv },
    { tipo: "PRODUTO", produtoId: "pFiltro", descricao: "Filtro", valorUnitario: pr },
    { tipo: "SERVICO", servicoId: null, descricao: "Avulso", valorUnitario: 1 },
  ]);

  it("as linhas viram a conferência: serviço e produto pelo catálogo, linha livre sem catálogo", () => {
    expect(linhas(150)).toEqual([
      { tipo: "servico", catalogoId: "sLimp", descricao: "Limpeza", valorUnitario: 150 },
      { tipo: "produto", catalogoId: "pFiltro", descricao: "Filtro", valorUnitario: 80 },
      { tipo: "servico", catalogoId: null, descricao: "Avulso", valorUnitario: 1 },
    ]);
    // O produto é conferido pelo produtoId, mesmo que um serviço tenha o mesmo id
    expect(itensDaMedicaoParaTrava([{ tipo: "PRODUTO", servicoId: "x", produtoId: "pFiltro", descricao: "F", valorUnitario: "70" as unknown as number }])[0])
      .toEqual({ tipo: "produto", catalogoId: "pFiltro", descricao: "F", valorUnitario: 70 });
  });

  it("no preço da tabela passa; fora dela: 403 sem permissão, 400 sem motivo; o já gravado não pede de novo", () => {
    expect(alteracoesDePrecoDeTabela(linhas(150), tabela)).toEqual([]);
    const alt = alteracoesDePrecoDeTabela(linhas(120, 70), tabela);
    expect(alt).toEqual([{ descricao: "Limpeza", valorTabela: 150, valorNovo: 120 }, { descricao: "Filtro", valorTabela: 80, valorNovo: 70 }]);
    expect(conferirPrecoDeTabela(alt, { podeAlterar: false })).toMatchObject({ ok: false, status: 403 });
    expect(conferirPrecoDeTabela(alt, { podeAlterar: true })).toMatchObject({ ok: false, status: 400 });
    expect(conferirPrecoDeTabela(alt, { podeAlterar: true, motivo: "Desconto negociado" })).toEqual({ ok: true, motivo: "Desconto negociado" });
    // Editar uma fatura que já tinha 120 (autorizado antes): passa
    expect(alteracoesDePrecoDeTabela(linhas(120), tabela, new Map([[chaveCatalogo("servico", "sLimp"), [120]]]))).toEqual([]);
  });

  it("na tela: abrir a fatura salva marca e trava sem trocar o preço gravado; item novo recebe o da tabela; trocar para cliente sem tabela destrava", () => {
    const itens: (ItemDaTela & { id: string; descricao: string; quantidade: number })[] = [
      { id: "a", catalogoId: "sLimp", descricao: "Limpeza", quantidade: 1, valorUnitario: 120, valorGravado: 120 },
      { id: "b", catalogoId: "sLimp", descricao: "Limpeza", quantidade: 2, valorUnitario: 999 },
    ];
    const t = { sLimp: { valorFinal: 150 } };
    const marcados = marcarItensDaTabela(itens, t, false);
    expect(marcados[0]).toMatchObject({ valorUnitario: 120, origemPreco: "contrato", valorTabela: 150, bloqueado: true });
    expect(marcados[1]).toMatchObject({ valorUnitario: 150, bloqueado: true });
    // O gravado não pede motivo; mudar o preço (com a permissão) pede
    expect(itensComPrecoDeTabelaAlterado(marcados)).toEqual([]);
    const comPermissao = marcarItensDaTabela(itens, t, true);
    expect(comPermissao[0].bloqueado).toBe(false);
    expect(itensComPrecoDeTabelaAlterado([{ ...comPermissao[1], valorUnitario: 140 }]).map((i) => i.id)).toEqual(["b"]);
    // Cliente sem tabela: destrava e o preço fica
    const semTabela = marcarItensDaTabela(marcados, null, false);
    expect(semTabela.map((i) => [i.valorUnitario, i.bloqueado, i.origemPreco])).toEqual([[120, false, undefined], [150, false, undefined]]);
  });
});

describe("6. reajuste em massa da tabela de preço", () => {
  const item = (id: string, p: Partial<ItemDaTabela>): ItemDaTabela => ({
    id, servicoId: `s-${id}`, produtoId: null, descricao: `Item ${id}`, tipoPreco: "VALOR_FIXO", valorFixo: 100, descontoPercent: null, valorFinal: 100, valorPadrao: 120, ...p,
  });
  const tabela = [
    item("a", { valorFixo: 150, valorFinal: 150 }),
    item("b", { valorFixo: 33.33, valorFinal: 33.33 }),
    // Desconto 10% sobre o padrão 200 = 180
    item("c", { tipoPreco: "DESCONTO_PERCENTUAL", valorFixo: null, descontoPercent: 10, valorFinal: 180, valorPadrao: 200 }),
  ];

  it("centavos: arredonda meio centavo para cima, sem o erro do ponto flutuante", () => {
    expect(centavos(1.005)).toBe(1.01);
    expect(centavos(35.995)).toBe(36);
    expect(centavos(-2.345)).toBe(-2.35);
    expect(precoReajustado(33.33, "PERCENTUAL", 10)).toBe(36.66);
    expect(precoReajustado(100, "PERCENTUAL", -7.5)).toBe(92.5);
    expect(precoReajustado(100, "VALOR", 12.5)).toBe(112.5);
  });

  it("% sobre todos: preço atual → novo; o item por desconto % passa a valor fixo com o preço novo", () => {
    const p = previaDoReajuste(tabela, { tipo: "PERCENTUAL", valor: 10 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.linhas.map((l) => [l.descricao, l.antes.valorFinal, l.depois.valorFinal])).toEqual([["Item a", 150, 165], ["Item b", 33.33, 36.66], ["Item c", 180, 198]]);
    expect(p.linhas[2].antes).toEqual({ tipoPreco: "DESCONTO_PERCENTUAL", valorFixo: null, descontoPercent: 10, valorFinal: 180 });
    expect(p.linhas[2].depois).toEqual({ tipoPreco: "VALOR_FIXO", valorFixo: 198, descontoPercent: null, valorFinal: 198 });
  });

  it("R$ só nos escolhidos; item escolhido que saiu da tabela é recusado; preço negativo recusa o reajuste inteiro; nada muda = erro", () => {
    const p = previaDoReajuste(tabela, { tipo: "VALOR", valor: -3.5, itemIds: ["b", "b"] });
    expect(p.ok && p.linhas.map((l) => [l.itemId, l.depois.valorFixo])).toEqual([["b", 29.83]]);
    expect(previaDoReajuste(tabela, { tipo: "VALOR", valor: 1, itemIds: ["zz"] })).toMatchObject({ ok: false, erro: expect.stringMatching(/não está mais na tabela/) });
    expect(previaDoReajuste(tabela, { tipo: "VALOR", valor: -40 })).toEqual({ ok: false, erro: "O reajuste deixaria negativo o preço de Item b." });
    expect(previaDoReajuste([item("z", { valorFixo: 0, valorFinal: 0 })], { tipo: "PERCENTUAL", valor: 10 })).toEqual({ ok: false, erro: "Nenhum preço muda com este reajuste." });
    expect(previaDoReajuste([], { tipo: "PERCENTUAL", valor: 10 })).toMatchObject({ ok: false, erro: expect.stringMatching(/não tem itens/) });
  });

  it("o pedido: tipo, valor diferente de zero, limites do %, seleção não vazia e o motivo (MOTIVO_MIN)", () => {
    expect(erroDoPedido({ tipo: "X", valor: 1 })).toMatch(/tipo/);
    expect(erroDoPedido({ tipo: "PERCENTUAL", valor: 0 })).toMatch(/diferente de zero/);
    expect(erroDoPedido({ tipo: "PERCENTUAL", valor: "" })).toMatch(/diferente de zero/);
    expect(erroDoPedido({ tipo: "PERCENTUAL", valor: -100 })).toMatch(/-99.99%/);
    expect(erroDoPedido({ tipo: "VALOR", valor: 5, itemIds: [] })).toMatch(/ao menos um item/);
    expect(erroDoPedido({ tipo: "VALOR", valor: 5, motivo: "ok" })).toMatch(/motivo/);
    expect(erroDoPedido({ tipo: "VALOR", valor: 5, motivo: "x".repeat(301) })).toMatch(/300/);
    expect(erroDoPedido({ tipo: "VALOR", valor: 5, motivo: "Reajuste anual", itemIds: ["a"] })).toBeNull();
    // Na prévia o motivo pode faltar
    expect(erroDoPedido({ tipo: "PERCENTUAL", valor: 8 })).toBeNull();
  });

  it("desfazer: volta o antes (o desconto com o valor final pelo padrão de agora); o item mudado depois ou tirado da tabela fica, com o aviso", () => {
    const p = previaDoReajuste(tabela, { tipo: "PERCENTUAL", valor: 10 });
    if (!p.ok) throw new Error(p.erro);
    // Como o lote deixou: a 165 e c 198 (c com o id novo: o editor recriou a linha); b mudou à mão depois
    const agora = [
      item("a", { valorFixo: 165, valorFinal: 165 }),
      item("b", { valorFixo: 40, valorFinal: 40 }),
      item("c-novo", { servicoId: "s-c", valorFixo: 198, valorFinal: 198, valorPadrao: 250 }),
    ];
    const plano = planoDeDesfazer(p.linhas, agora);
    expect(plano.voltam.map((v) => [v.itemId, v.atual, v.preco])).toEqual([
      ["a", 165, { tipoPreco: "VALOR_FIXO", valorFixo: 150, descontoPercent: null, valorFinal: 150 }],
      ["c-novo", 198, { tipoPreco: "DESCONTO_PERCENTUAL", valorFixo: null, descontoPercent: 10, valorFinal: 225 }],
    ]);
    expect(plano.ignorados).toEqual([{ descricao: "Item b", motivo: "alterado" }]);
    expect(avisoDosIgnorados(plano.ignorados)).toBe("Item b foi alterado depois do reajuste: fica como está.");
    const semA = planoDeDesfazer(p.linhas, agora.slice(1));
    expect(semA.ignorados).toContainEqual({ descricao: "Item a", motivo: "removido" });
    expect(avisoDosIgnorados(semA.ignorados)).toBe("Item b foi alterado depois do reajuste; Item a saiu da tabela: ficam como estão.");
    expect(avisoDosIgnorados([])).toBeNull();
  });

  it("o resumo do lote", () => {
    expect(textoDoReajuste("PERCENTUAL", 8.5)).toBe("+8,5%");
    expect(textoDoReajuste("PERCENTUAL", -5)).toBe("-5%");
    expect(textoDoReajuste("VALOR", 12)).toBe("+R$ 12,00");
    expect(textoDoReajuste("VALOR", -3.5)).toBe("-R$ 3,50");
  });
});
