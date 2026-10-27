/**
 * Compras 2/2 — Conciliação NF ↔ Pedido de Compra: as regras puras (lib/compras/conciliacao).
 * Casamento por item (produto → descrição), quantidade (falta × sobra), pontuação com cada sinal,
 * "idêntico" × "sugestão", status por cobertura, valor real ponderado e o texto do histórico.
 */
import { describe, expect, it } from "vitest";
import {
  avaliarPedido, casarItens, faltaNoItem, LIMIAR_SUGESTAO, notaDepoisDoPedido, palavras, semelhanca, statusPorCobertura,
  statusSemNota, sugerirPedidos, textoVinculo, valorRealDoItem, type ItemNotaConc, type ItemPedidoConc, type NotaConc, type PedidoConc,
} from "@/lib/compras/conciliacao";

const D = (s: string) => new Date(`${s}T12:00:00Z`);
const ip = (id: string, x: Partial<ItemPedidoConc> = {}): ItemPedidoConc =>
  ({ id, produtoId: null, descricao: id, quantidade: 1, unidade: "un", valorEstimado: null, recebido: 0, ...x });
const ni = (id: string, x: Partial<ItemNotaConc> = {}): ItemNotaConc =>
  ({ id, numeroItem: 1, produtoId: null, produtoNome: null, descricao: id, quantidade: 1, valorUnitario: 10, disponivel: x.quantidade ?? 1, ...x });
const ped = (x: Partial<PedidoConc> = {}): PedidoConc =>
  ({ id: "p1", numero: "PCI-2026-0001", status: "COTANDO", criadoEm: D("2026-10-01"), fornecedorId: "f1", itens: [], ...x });
const nf = (itens: ItemNotaConc[], x: Partial<NotaConc> = {}): NotaConc =>
  ({ id: "n1", numero: "4610/1", fornecedorId: "f1", dataEmissao: D("2026-10-10"), itens, ...x });

/** Pedido de 2 itens com produto (gás 2, filtro 4) e a NF exata dele */
const GAS = ip("pi-gas", { produtoId: "gas", descricao: "Gás R410A", quantidade: 2, valorEstimado: 100 });
const FIL = ip("pi-fil", { produtoId: "fil", descricao: "Filtro secador", quantidade: 4, valorEstimado: 25 });
const NGAS = ni("n-gas", { numeroItem: 1, produtoId: "gas", quantidade: 2, valorUnitario: 100 });
const NFIL = ni("n-fil", { numeroItem: 2, produtoId: "fil", quantidade: 4, valorUnitario: 25 });

describe("semelhança da descrição", () => {
  it("palavras: sem acento, minúsculas, sem palavras vazias; número de 1 dígito fica", () => {
    expect(palavras("Filtro Secador 1/4\" (Danfoss) para a ÁGUA")).toEqual(["filtro", "secador", "1", "4", "danfoss", "agua"]);
    expect(palavras("a x de")).toEqual([]);
  });
  it("Dice: iguais = 1, nada em comum = 0, vazio = 0, metade", () => {
    expect(semelhanca("Gás R410A", "gas r410a")).toBe(1);
    expect(semelhanca("Gás R410A", "Filtro")).toBe(0);
    expect(semelhanca("", "Filtro")).toBe(0);
    expect(semelhanca("Filtro", "")).toBe(0);
    expect(semelhanca("filtro secador", "filtro capilar")).toBe(0.5);
    expect(semelhanca("filtro secador 032", "filtro")).toBe(0.5);
  });
});

describe("casarItens: por item, com a quantidade", () => {
  it("produto dos dois lados: só o mesmo produto, nunca pela descrição", () => {
    const pares = casarItens({ itens: [GAS] }, { itens: [ni("x", { produtoId: "outro", descricao: "Gás R410A", quantidade: 2 }), NGAS] });
    expect(pares).toEqual([{ pedidoItemId: "pi-gas", notaItemId: "n-gas", quantidade: 2, valorUnitario: 100, criterio: "PRODUTO", semelhanca: 1 }]);
  });
  it("sem produto: descrição ≥ 50% (a do produto do de-para também conta); abaixo não casa", () => {
    const pi = ip("pi", { descricao: "Filtro secador 032", quantidade: 3 });
    expect(casarItens({ itens: [pi] }, { itens: [ni("a", { descricao: "FILTRO SECADOR 032S SOLDA", quantidade: 3 })] })).toMatchObject([{ criterio: "DESCRICAO", semelhanca: 0.57 }]);
    expect(casarItens({ itens: [pi] }, { itens: [ni("a", { descricao: "FILTRO CAPILAR 1/4 SOLDA", quantidade: 3 })] })).toEqual([]);
    const pares = casarItens({ itens: [pi] }, { itens: [ni("a", { descricao: "XPTO 99", produtoId: "fil", produtoNome: "Filtro secador 032", quantidade: 3 })] });
    expect(pares).toMatchObject([{ notaItemId: "a", quantidade: 3, criterio: "DESCRICAO", semelhanca: 1 }]);
    expect(casarItens({ itens: [ip("pi", { descricao: "filtro secador" })] }, { itens: [ni("a", { descricao: "filtro capilar" })] }))
      .toMatchObject([{ criterio: "DESCRICAO", semelhanca: 0.5 }]);
  });
  it("quantidade: até o que falta no pedido e até o que sobra na NF; o mais parecido primeiro, depois a ordem da NF", () => {
    const pi = ip("pi", { descricao: "cabo pp 3x2", quantidade: 10, recebido: 3 }); // falta 7
    const pares = casarItens({ itens: [pi] }, {
      itens: [
        ni("b", { numeroItem: 2, descricao: "cabo pp 3x2", quantidade: 5, disponivel: 5 }),
        ni("a", { numeroItem: 1, descricao: "cabo pp 3x2", quantidade: 5, disponivel: 4 }),
        ni("c", { numeroItem: 3, descricao: "cabo pp 3x2 preto", quantidade: 9, disponivel: 9 }),
      ],
    });
    expect(pares.map((p) => [p.notaItemId, p.quantidade])).toEqual([["a", 4], ["b", 3]]);
  });
  it("o mesmo item da NF não é usado duas vezes além do que tem", () => {
    const pares = casarItens({ itens: [ip("x", { produtoId: "g", quantidade: 3 }), ip("y", { produtoId: "g", quantidade: 3 })] },
      { itens: [ni("a", { produtoId: "g", quantidade: 4 })] });
    expect(pares.map((p) => [p.pedidoItemId, p.quantidade])).toEqual([["x", 3], ["y", 1]]);
  });
  it("item já recebido inteiro e item da NF já usado ficam de fora", () => {
    expect(casarItens({ itens: [ip("x", { produtoId: "g", quantidade: 2, recebido: 2 })] }, { itens: [ni("a", { produtoId: "g", quantidade: 2 })] })).toEqual([]);
    expect(casarItens({ itens: [ip("x", { produtoId: "g", quantidade: 2 })] }, { itens: [ni("a", { produtoId: "g", quantidade: 2, disponivel: 0 })] })).toEqual([]);
    expect(faltaNoItem({ quantidade: 2, recebido: 3 })).toBe(0);
    expect(faltaNoItem({ quantidade: 2.5, recebido: 1 })).toBe(1.5);
  });
});

describe("avaliarPedido: pontuação, motivos e idêntico", () => {
  it("idêntico: mesmo fornecedor + todos os itens pelo produto + mesmas quantidades = 100 pontos", () => {
    const a = avaliarPedido(ped({ itens: [GAS, FIL] }), nf([NGAS, NFIL]))!;
    expect(a).toMatchObject({ pontos: 100, identico: true, itensAbertos: 2, itensCasados: 2, itensCobertos: 2 });
    expect(a.motivos).toEqual([
      "Mesmo fornecedor da NF",
      "2 de 2 itens batem: Gás R410A (produto); Filtro secador (produto)",
      "Quantidades: a NF cobre tudo o que falta",
      "NF emitida 9 dias depois do pedido",
      "Valor da NF igual ao estimado",
    ]);
  });

  it("não é idêntico: outro fornecedor / quantidade diferente / item a mais na NF / pela descrição / já recebeu NF", () => {
    expect(avaliarPedido(ped({ itens: [GAS, FIL] }), nf([NGAS, NFIL], { fornecedorId: "f2" }))!.identico).toBe(false);
    expect(avaliarPedido(ped({ fornecedorId: null, itens: [GAS, FIL] }), nf([NGAS, NFIL]))!.identico).toBe(false);
    expect(avaliarPedido(ped({ itens: [GAS, FIL] }), nf([NGAS, { ...NFIL, quantidade: 3, disponivel: 3 }]))!.identico).toBe(false);
    expect(avaliarPedido(ped({ itens: [GAS, FIL] }), nf([NGAS, { ...NFIL, quantidade: 5, disponivel: 5 }]))!.identico).toBe(false);
    expect(avaliarPedido(ped({ itens: [GAS, FIL] }), nf([NGAS, NFIL, ni("extra", { produtoId: "zz" })]))!.identico).toBe(false);
    expect(avaliarPedido(ped({ itens: [GAS, { ...FIL, produtoId: null }] }), nf([NGAS, { ...NFIL, descricao: "Filtro secador" }]))!.identico).toBe(false);
    expect(avaliarPedido(ped({ itens: [{ ...GAS, quantidade: 4, recebido: 2 }, FIL] }), nf([NGAS, NFIL]))!.identico).toBe(false);
  });

  it("parcial: metade dos itens = 45·½ + 20·½ + 20 + 5 + 10 = 67,5 → 68; motivos dizem o que bateu", () => {
    const a = avaliarPedido(ped({ itens: [GAS, FIL] }), nf([NGAS]))!;
    expect(a).toMatchObject({ pontos: 68, identico: false, itensCasados: 1, itensCobertos: 1 });
    expect(a.motivos[1]).toBe("1 de 2 itens batem: Gás R410A (produto)");
    expect(a.motivos[2]).toBe("Quantidades: 1 de 2 itens cobertos inteiros (entrega parcial)");
  });

  it("quantidade só em parte: casa mas não cobre (45 + 0 + 20 + 5 + 10 = 80) e a descrição mostra a %", () => {
    const a = avaliarPedido(ped({ itens: [ip("pi", { descricao: "filtro secador", quantidade: 4, valorEstimado: 10 })] }),
      nf([ni("a", { descricao: "filtro capilar", quantidade: 1, valorUnitario: 10 })]))!;
    expect(a.pontos).toBe(80);
    expect(a.motivos[1]).toBe("1 de 1 item bate: filtro secador (descrição parecida, 50%)");
    expect(a.motivos[2]).toBe("Quantidades: 0 de 1 item coberto inteiros (entrega parcial)");
  });

  it("fornecedor: 20 o mesmo · 10 pedido sem fornecedor · 0 outro", () => {
    const pts = (fornecedorId: string | null) => avaliarPedido(ped({ fornecedorId, itens: [GAS] }), nf([NGAS]))!;
    expect(pts("f1").pontos).toBe(100);
    expect(pts(null).pontos).toBe(90);
    expect(pts(null).motivos[0]).toBe("Pedido sem fornecedor definido");
    expect(pts("f9").pontos).toBe(80);
    expect(pts("f9").motivos[0]).toBe("Fornecedor do pedido é outro");
  });

  it("datas: NF antes do pedido não é candidata (1 dia de folga); até 60 dias = 5, depois = 2", () => {
    expect(notaDepoisDoPedido(D("2026-09-30"), D("2026-10-01"))).toBe(true);
    expect(notaDepoisDoPedido(new Date(D("2026-09-30").getTime() - 1), D("2026-10-01"))).toBe(false);
    expect(avaliarPedido(ped({ itens: [GAS] }), nf([NGAS], { dataEmissao: D("2026-09-29") }))).toBeNull();
    const em = (d: string) => avaliarPedido(ped({ itens: [GAS] }), nf([NGAS], { dataEmissao: D(d) }))!;
    expect(em("2026-10-01").motivos[3]).toBe("NF emitida no dia do pedido");
    expect(em("2026-09-30").motivos[3]).toBe("NF emitida no dia do pedido");
    expect(em("2026-10-02").motivos[3]).toBe("NF emitida 1 dia depois do pedido");
    expect(em("2026-11-30").pontos).toBe(100); // 60 dias
    expect(em("2026-12-01").pontos).toBe(97); // 61 dias
  });

  it("valor: até 10% = 10 · até 25% = 5 · mais = 0 · sem estimado = 5", () => {
    const comCusto = (v: number) => avaliarPedido(ped({ itens: [GAS] }), nf([{ ...NGAS, valorUnitario: v }]))!;
    expect(comCusto(110).pontos).toBe(100);
    expect(comCusto(110).motivos[4]).toBe("Valor da NF 10% acima do estimado");
    expect(comCusto(111).pontos).toBe(95);
    expect(comCusto(75).pontos).toBe(95);
    expect(comCusto(75).motivos[4]).toBe("Valor da NF 25% abaixo do estimado");
    expect(comCusto(74).pontos).toBe(90);
    expect(comCusto(126).pontos).toBe(90);
    const sem = avaliarPedido(ped({ itens: [{ ...GAS, valorEstimado: null }] }), nf([NGAS]))!;
    expect([sem.pontos, sem.motivos[4]]).toEqual([95, "Pedido sem valor estimado para comparar"]);
    // estimado só dos itens que têm: o item sem estimado não entra na conta
    const misto = avaliarPedido(ped({ itens: [GAS, { ...FIL, valorEstimado: null }] }), nf([NGAS, { ...NFIL, valorUnitario: 99 }]))!;
    expect(misto.motivos[4]).toBe("Valor da NF igual ao estimado");
  });

  it("não é candidato: pedido fechado, nada em aberto ou nada casa", () => {
    for (const status of ["CONCLUIDO", "CANCELADO", "COMPRADO", "ENTREGUE"]) expect(avaliarPedido(ped({ status, itens: [GAS] }), nf([NGAS]))).toBeNull();
    for (const status of ["SOLICITADO", "COTANDO", "PARCIAL"]) expect(avaliarPedido(ped({ status, itens: [GAS] }), nf([NGAS]))).not.toBeNull();
    expect(avaliarPedido(ped({ itens: [{ ...GAS, recebido: 2 }] }), nf([NGAS]))).toBeNull();
    expect(avaliarPedido(ped({ itens: [GAS] }), nf([NFIL]))).toBeNull();
    expect(avaliarPedido(ped({ itens: [] }), nf([NGAS]))).toBeNull();
  });

  it("pedido parcial: conta só o que falta (recebido de outra NF)", () => {
    const a = avaliarPedido(ped({ status: "PARCIAL", itens: [{ ...GAS, recebido: 2 }, FIL] }), nf([NFIL]))!;
    expect(a).toMatchObject({ itensAbertos: 1, itensCasados: 1, itensCobertos: 1, pontos: 100, identico: false });
    expect(a.motivos[1]).toBe("1 de 1 item bate: Filtro secador (produto)");
  });
});

describe("sugerirPedidos", () => {
  const p = (id: string, x: Partial<PedidoConc>) => ped({ id, numero: id, ...x });
  it(`sugere a partir de ${LIMIAR_SUGESTAO} pontos, no máximo 3, maior primeiro (empate: o mais novo)`, () => {
    const r = sugerirPedidos([
      p("baixo", { fornecedorId: "f9", itens: [ip("a", { produtoId: "gas", quantidade: 10, valorEstimado: 1 }), ip("b"), ip("c"), ip("d"), ip("e")] }),
      p("velho", { criadoEm: D("2026-09-01"), itens: [GAS] }),
      p("novo", { criadoEm: D("2026-10-05"), itens: [GAS] }),
      p("meio", { itens: [GAS, FIL] }),
      p("outro", { fornecedorId: "f9", itens: [GAS] }),
    ], nf([NGAS]));
    expect(r.sugestoes.map((s) => [s.pedidoId, s.pontos])).toEqual([["novo", 100], ["velho", 100], ["outro", 80]]);
    expect(r.automatico).toBeNull(); // dois idênticos = ambíguo
  });
  it("exatamente 40 entra; 39 não", () => {
    // 45·⅓ + 0 + 0 (outro fornecedor) + 2 (data) + 5 (sem estimado) = 22 → não; ajusta para chegar a 40 e 39
    const um = (itens: ItemPedidoConc[], x: Partial<PedidoConc> = {}) => sugerirPedidos([p("x", { itens, ...x })], nf([NGAS], { dataEmissao: D("2027-01-01") })).sugestoes.length;
    // 1 de 2 casado e coberto: 22,5 + 10 + 0 + 2 + 5 = 39,5 → 40
    expect(um([{ ...GAS, valorEstimado: null }, FIL], { fornecedorId: "f9" })).toBe(1);
    // 1 de 3 casado e coberto + sem fornecedor: 15 + 6,67 + 10 + 2 + 5 = 38,67 → 39
    expect(um([{ ...GAS, valorEstimado: null }, FIL, ip("z")], { fornecedorId: null })).toBe(0);
  });
  it("o idêntico vem primeiro mesmo empatado em pontos com um mais novo", () => {
    // "maior": 10 kg pedidos, a NF tem 11 → cobre, mas sobra NF (não é idêntico); 100 pontos e mais novo
    const r = sugerirPedidos([
      p("maior", { criadoEm: D("2026-10-05"), itens: [{ ...GAS, quantidade: 1 }] }),
      p("ident", { criadoEm: D("2026-10-01"), itens: [GAS] }),
    ], nf([NGAS]));
    expect(r.sugestoes.map((s) => [s.pedidoId, s.pontos, s.identico])).toEqual([["ident", 100, true], ["maior", 100, false]]);
    expect(r.automatico?.pedidoId).toBe("ident");
  });
  it("vincula sozinho só o ÚNICO idêntico", () => {
    const r = sugerirPedidos([p("ident", { itens: [GAS] }), p("outro", { fornecedorId: "f9", itens: [GAS] })], nf([NGAS]));
    expect(r.automatico?.pedidoId).toBe("ident");
    expect(sugerirPedidos([], nf([NGAS]))).toEqual({ sugestoes: [], automatico: null });
  });
});

describe("status e valor real", () => {
  it("sem NF: Em cotação se já foi baixado/enviado; senão Solicitado", () => {
    expect(statusSemNota([])).toBe("SOLICITADO");
    expect(statusSemNota(["CRIADO", "EDITADO"])).toBe("SOLICITADO");
    expect(statusSemNota(["BAIXADO"])).toBe("COTANDO");
    expect(statusSemNota(["ENVIADO_EMAIL"])).toBe("COTANDO");
    expect(statusSemNota(["ENVIADO_WHATSAPP"])).toBe("COTANDO");
  });
  it("cobertura: tudo = Concluída; parte = Parcial; nada = o status sem NF", () => {
    expect(statusPorCobertura([{ quantidade: 2, recebido: 2 }, { quantidade: 4, recebido: 4 }], "COTANDO")).toBe("CONCLUIDO");
    expect(statusPorCobertura([{ quantidade: 2, recebido: 2 }, { quantidade: 4, recebido: 0 }], "COTANDO")).toBe("PARCIAL");
    expect(statusPorCobertura([{ quantidade: 2, recebido: 1 }], "COTANDO")).toBe("PARCIAL");
    expect(statusPorCobertura([{ quantidade: 2, recebido: 0 }], "SOLICITADO")).toBe("SOLICITADO");
    expect(statusPorCobertura([], "COTANDO")).toBe("COTANDO");
    expect(statusPorCobertura([{ quantidade: 2, recebido: 3 }], "COTANDO")).toBe("CONCLUIDO");
  });
  it("valor real: média ponderada das NFs; sem vínculo volta ao de antes", () => {
    expect(valorRealDoItem([{ quantidade: 1, valorUnitario: 10 }, { quantidade: 3, valorUnitario: 14 }], 9)).toBe(13);
    expect(valorRealDoItem([{ quantidade: 3, valorUnitario: 10.005 }], null)).toBe(10.01);
    expect(valorRealDoItem([], 9)).toBe(9);
    expect(valorRealDoItem([], null)).toBeNull();
  });
  it("texto do histórico", () => {
    expect(textoVinculo({ nota: "4610/1", acao: "vinculada", itens: [{ descricao: "Filtro", quantidade: 4, unidade: "un" }, { descricao: "Gás", quantidade: 2.5, unidade: "kg" }], status: "PARCIAL" }))
      .toBe("NF 4610/1 vinculada: Filtro 4 un; Gás 2,5 kg — status Parcial");
    expect(textoVinculo({ nota: "1/1", acao: "vinculada", automatico: true, itens: [{ descricao: "Gás", quantidade: 1, unidade: "un" }], status: "CONCLUIDO" }))
      .toBe("NF 1/1 vinculada automaticamente (idêntica ao pedido): Gás 1 un — status Concluída");
    expect(textoVinculo({ nota: "1/1", acao: "desvinculada", itens: [], status: "COTANDO" })).toBe("NF 1/1 desvinculada:  — status Em cotação");
  });
});
