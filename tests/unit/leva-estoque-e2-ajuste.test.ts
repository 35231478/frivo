/**
 * Estoque E2 — ajuste: conversão de unidade que aprende, preço de venda por margem (sobre a venda) e
 * dados fiscais do XML. Rotas e telas reais, banco em memória (DUAS empresas), fixtures de NF-e 4.00
 * de um fornecedor de gás (nfe-4800: 1 cilindro "UN" a R$ 1.360; nfe-4855: 2 cilindros a R$ 1.428). Prova:
 *  - conversão: 1 UN = 13,6 kg → entram 13,6 kg a R$ 100,00/kg; o de-para aprende a unidade e o fator
 *    e a 2ª nota já chega com o fator (ajustável); unidade da nota diferente da aprendida não usa o fator;
 *  - preço: margem 30% sobre a venda com custo R$ 100 → R$ 142,86 (markup 42,9%); preço fixo recalcula a
 *    margem; a API grava margem alvo ou preço fixo;
 *  - custo mudou: só AVISA (na conciliação, no lançamento e no resultado) — o preço nunca muda sozinho;
 *  - fiscal: NCM, CEST, GTIN, origem e unidade tributável do XML vão para o produto novo; no existente,
 *    só onde está vazio (diferente = aviso, fica o do cadastro);
 *  - empresa sempre da sessão e permissões.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { lerNfe } from "@/lib/compras/nfe";
import { avisoCusto, converterItem, formatarPct, margemSobreVenda, markupSobreCusto, precoPorMargem } from "@/lib/estoque/preco";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const por = (T: (m: string) => any[], m: string, id: string | null | undefined) => T(m).find((x) => x.id === id) ?? null;
  // data/criadoEm do banco (default now()): aqui, pela ordem de criação — a entrada mais nova é a última
  // (no passado: o lançamento de uma nota acontece "agora", depois das entradas que vieram antes dela)
  const quando = (r: any) => r.data ?? new Date(Date.UTC(2020, 0, 1) + Number(String(r.id).split("-").pop()) * 60_000);
  return {
    prisma: criarPrisma(db, {
      notaCompra: (n, T) => ({
        criadoEm: n.criadoEm ?? new Date("2026-11-05T12:00:00Z"),
        fornecedor: por(T, "fornecedor", n.fornecedorId),
        itens: T("notaCompraItem").filter((i) => i.notaId === n.id).map((i) => ({ ...i, produto: por(T, "produto", i.produtoId) })),
        contasPagar: T("contaPagar").filter((c) => c.notaCompraId === n.id),
        pedidoCompra: por(T, "pedidoCompraInterno", n.pedidoCompraId),
        usuario: por(T, "usuario", n.usuarioId),
        _count: { itens: T("notaCompraItem").filter((i) => i.notaId === n.id).length },
      }),
      notaCompraItem: (i, T) => ({ produto: por(T, "produto", i.produtoId) }),
      movimentacaoEstoque: (m, T) => ({ produto: por(T, "produto", m.produtoId), data: quando(m), criadoEm: quando(m) }),
      deParaProdutoFornecedor: (d, T) => { const p = por(T, "produto", d.produtoId); return { produto: p && { ...p, ativo: p.ativo ?? true } }; },
      pedidoCompraInterno: (p, T) => ({ contasPagar: T("contaPagar").filter((c) => c.pedidoCompraId === p.id) }),
    }, { notaCompra: { itens: ["notaCompraItem", "notaId"] } }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => "/estoque/notas", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes } };
};
const so = (p: Record<string, Record<string, boolean>>): Permissoes => ({ ...permissoesVazias(), ...p });

const FIX = (f: string) => readFileSync(path.resolve(__dirname, "fixtures/nfe", f), "utf8");
const XML1 = FIX("nfe-4800-refrigas.xml"); // gás 1 UN × 1.360,00 + válvula 6 PC × 15,50
const XML2 = FIX("nfe-4855-refrigas.xml"); // gás 2 UN × 1.428,00 (custo/kg 105) e outro NCM

function semear() {
  db.escritas = [];
  db.t = {
    empresa: [{ id: "e1", cnpj: "12.345.678/0001-90" }, { id: "e2", cnpj: "99888777000166" }],
    usuario: [{ id: "u1", nome: "Ana" }],
    fornecedor: [],
    produto: [
      { id: "pGas", empresaId: "e1", nome: "Gás R404A", unidade: "kg", saldo: 0, ativo: true, valorPadrao: null, margemVenda: null, ncm: null, cest: null, gtin: null, origemMercadoria: null, unidadeTributavel: null },
      { id: "pVal", empresaId: "e1", nome: "Válvula de serviço 1/4", unidade: "pc", saldo: 0, ativo: true, valorPadrao: 29.9, margemVenda: null, ncm: "84818099", cest: "9999999", gtin: null, origemMercadoria: null, unidadeTributavel: null },
      { id: "pB", empresaId: "e2", nome: "Gás da outra empresa", unidade: "kg", saldo: 0, ativo: true, valorPadrao: 10, margemVenda: null },
    ],
    notaCompra: [], notaCompraItem: [], deParaProdutoFornecedor: [], movimentacaoEstoque: [],
    contaPagar: [],
    pedidoCompraInterno: [{ id: "ped1", empresaId: "e1", numero: "PC-0400", status: "COMPRADO" }],
    pedidoCompraItem: [{ id: "pi1", pedidoId: "ped1", produtoId: "pGas", descricao: "Gás R404A", quantidade: 13.6, valorEstimado: 95, valorReal: null }],
  };
}
beforeEach(() => { semear(); logar(); });

const T = (m: string) => (db.t as any)[m] as any[];
const prod = (id: string) => T("produto").find((p) => p.id === id);
async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await carregar();
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const importar = (xml: string) => chamar(() => import("@/app/api/compras/notas/route"), "POST", {}, { xml });
const conciliarApi = (id: string, itens: unknown) => chamar(() => import("@/app/api/compras/notas/[id]/conciliacao/route"), "PUT", { id }, { itens });
const lancarApi = (id: string, corpo: unknown = {}) => chamar(() => import("@/app/api/compras/notas/[id]/lancar/route"), "POST", { id }, corpo);
const precoApi = (produtoId: string, corpo: unknown) => chamar(() => import("@/app/api/estoque/[produtoId]/preco/route"), "PUT", { produtoId }, corpo);
const buscarApi = (q: string) => chamar(() => import("@/app/api/compras/produtos/route"), "GET", {}, undefined, `http://localhost/api/compras/produtos?q=${encodeURIComponent(q)}`);
const itensDa = (notaId: string) => T("notaCompraItem").filter((i) => i.notaId === notaId).sort((a, b) => a.numeroItem - b.numeroItem);
const movsDa = (notaId: string) => T("movimentacaoEstoque").filter((m) => m.refId === notaId);
const detalhe = async (id: string) => { const { default: P } = await import("@/app/(dashboard)/estoque/notas/[id]/page"); return renderToStaticMarkup(await P({ params: Promise.resolve({ id }) })); };
const paginaProduto = async (produtoId: string) => {
  const { default: P } = await import("@/app/(dashboard)/estoque/[produtoId]/page");
  return renderToStaticMarkup(await P({ params: Promise.resolve({ produtoId }), searchParams: Promise.resolve({}) }));
};
/** R$ formatado usa espaço não separável: compara como espaço comum */
const sp = (s: string) => s.replace(/\u00a0/g, " ");
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");

/** NF 4800 conciliada (gás → pGas com o fator; válvula → pVal) e lançada */
async function nota1Lancada(fator = 13.6, extra: Record<string, unknown> = {}) {
  const id = (await importar(XML1)).json.nota.id;
  const [gas, val] = itensDa(id);
  const r = await lancarApi(id, { itens: [{ itemId: gas.id, produtoId: "pGas", fator }, { itemId: val.id, produtoId: "pVal" }], ...extra });
  expect(r.status).toBe(201);
  return { id, r };
}

// ═════════════════════════ Conversão de unidade ═════════════════════════
describe("conversão de unidade que aprende (gás em cilindro → kg)", () => {
  it("NF de 1 UN a R$ 1.360 com fator 13,6 → entram 13,6 kg a R$ 100,00/kg; o de-para aprende UN = 13,6 kg", async () => {
    const { id, r } = await nota1Lancada(13.6, { pedidoCompraId: "ped1" });
    expect(r.json.entradas[0]).toEqual({ itemId: expect.any(String), produto: "Gás R404A", unidade: "kg", quantidade: 13.6, custoUnitario: 100, fator: 13.6, saldo: 13.6 });
    const [mGas, mVal] = movsDa(id);
    expect([mGas.quantidade, mGas.custoUnitario, mGas.saldoApos]).toEqual([13.6, 100, 13.6]);
    expect(mGas.observacao).toBe("NF 4800/1 · REFRIGAS DISTRIBUIDORA DE GASES LTDA · item 1 · 1 UN × 13.6");
    expect([mVal.quantidade, mVal.custoUnitario]).toEqual([6, 15.5]); // PC × pc: mesma unidade, 1:1
    expect(prod("pGas").saldo).toBe(13.6);
    // a dívida é a da nota (a conversão não mexe em valor)
    expect(T("contaPagar").filter((c) => c.notaCompraId === id).map((c) => c.valorTotal)).toEqual([1453]);
    // pedido de compra recebe o custo real NA UNIDADE DO PRODUTO (R$/kg)
    expect(T("pedidoCompraItem")[0].valorReal).toBe(100);
    expect(T("deParaProdutoFornecedor").find((d) => d.codigoFornecedor === "R404A-136")).toMatchObject({ produtoId: "pGas", unidadeOrigem: "UN", fatorConversao: 13.6 });
  });

  it("2ª nota do mesmo fornecedor: já vem com o produto E o fator 13,6 — entram 27,2 kg a R$ 105,00/kg", async () => {
    await nota1Lancada();
    const imp = await importar(XML2);
    const id2 = imp.json.nota.id;
    expect(imp.json.preVinculados).toBe(1);
    expect(itensDa(id2)[0]).toMatchObject({ produtoId: "pGas", unidade: "UN", fatorConversao: 13.6 });
    const h = texto(await detalhe(id2));
    expect(h).toContain("fator aprendido da nota anterior");
    expect(await detalhe(id2)).toMatch(/data-fator-item="1"[^>]*value="13,6"|value="13,6"[^>]*data-fator-item="1"/);
    expect(h).toMatch(/Entra 27,2 kg · custo R\$ 105,00\/kg/);
    const r = await lancarApi(id2);
    expect(r.json.entradas[0]).toMatchObject({ quantidade: 27.2, custoUnitario: 105, fator: 13.6, saldo: 40.8 });
  });

  it("o fator pré-preenchido é ajustável: a conciliação grava o novo e o de-para passa a ensinar ele", async () => {
    await nota1Lancada();
    const id2 = (await importar(XML2)).json.nota.id;
    const [gas] = itensDa(id2);
    expect((await conciliarApi(id2, [{ itemId: gas.id, produtoId: "pGas", fator: 12.5 }])).status).toBe(200);
    expect(gas.fatorConversao).toBe(12.5);
    const r = await lancarApi(id2);
    expect(r.json.entradas[0]).toMatchObject({ quantidade: 25, custoUnitario: 114.24 });
    expect(T("deParaProdutoFornecedor").find((d) => d.codigoFornecedor === "R404A-136")!.fatorConversao).toBe(12.5);
  });

  it("o fornecedor mudou a unidade (CX em vez de UN): o fator aprendido NÃO é usado e a tela avisa", async () => {
    await nota1Lancada();
    const id2 = (await importar(XML2.replace("<uCom>UN</uCom>", "<uCom>CX</uCom>"))).json.nota.id;
    expect(itensDa(id2)[0]).toMatchObject({ produtoId: "pGas", unidade: "CX", fatorConversao: 1 });
    const h = await detalhe(id2);
    expect(h).toContain("data-unidade-mudou");
    expect(texto(h)).toContain("Antes este item vinha em “UN” (1 UN = 13,6 kg); nesta nota veio em “CX”. Confira o fator.");
    expect(texto(h)).toContain("Informe quantos kg vêm em 1 CX.");
  });

  it("fator inválido (zero, negativo, texto, gigante) = 400 e nada muda", async () => {
    const id = (await importar(XML1)).json.nota.id;
    const [gas] = itensDa(id);
    for (const fator of [0, -2, "13,6", 2_000_000]) {
      const r = await conciliarApi(id, [{ itemId: gas.id, produtoId: "pGas", fator }]);
      expect(r.status).toBe(400);
    }
    expect((await lancarApi(id, { itens: [{ itemId: gas.id, produtoId: "pGas", fator: 0 }] })).status).toBe(400);
    expect(gas).toMatchObject({ produtoId: null, fatorConversao: 1 });
    expect(T("movimentacaoEstoque")).toEqual([]);
  });

  it("conversão (puro): quantidade × fator, custo = valor ÷ fator (4 casas)", () => {
    expect(converterItem(1, 1360, 13.6)).toEqual({ quantidade: 13.6, custoUnitario: 100 });
    expect(converterItem(3, 100, 3)).toEqual({ quantidade: 9, custoUnitario: 33.3333 });
    expect(converterItem(2, 50, 1)).toEqual({ quantidade: 2, custoUnitario: 50 });
  });
});

// ═════════════════════════ Precificação ═════════════════════════
describe("preço de venda por margem (sobre a venda) ou fixo", () => {
  it("margem 30% sobre a venda com custo R$ 100 → R$ 142,86; markup exibido 42,9%", () => {
    const preco = precoPorMargem(100, 30)!;
    expect(preco).toBe(142.86);
    expect(formatarPct(margemSobreVenda(preco, 100))).toBe("30,0%");
    expect(formatarPct(markupSobreCusto(preco, 100))).toBe("42,9%");
  });

  it("preço fixo recalcula a margem e o markup exibidos", () => {
    expect(formatarPct(margemSobreVenda(150, 100))).toBe("33,3%");
    expect(formatarPct(markupSobreCusto(150, 100))).toBe("50,0%");
    expect(formatarPct(margemSobreVenda(90, 100))).toBe("-11,1%"); // abaixo do custo: margem negativa visível
  });

  it("limites: margem ≥ 100% ou negativa, custo zero ou ausente → sem preço; markup sem custo = —", () => {
    expect(precoPorMargem(100, 100)).toBeNull();
    expect(precoPorMargem(100, -5)).toBeNull();
    expect(precoPorMargem(0, 30)).toBeNull();
    expect(precoPorMargem(null, 30)).toBeNull();
    expect(precoPorMargem(100, 0)).toBe(100);
    expect(formatarPct(markupSobreCusto(150, 0))).toBe("—");
    expect(margemSobreVenda(0, 100)).toBeNull();
  });

  it("API: por margem grava o preço calculado e a margem alvo; preço fixo grava o preço e limpa a margem", async () => {
    await nota1Lancada(); // último custo do gás: R$ 100/kg
    const r = await precoApi("pGas", { modo: "margem", margem: 30, custoBase: 100 });
    expect(r).toEqual({ status: 200, json: { preco: 142.86, margemVenda: 30, custo: 100, margem: expect.closeTo(30.0014, 3), markup: expect.closeTo(42.86, 2) } });
    expect(prod("pGas")).toMatchObject({ valorPadrao: 142.86, margemVenda: 30 });
    const f = await precoApi("pGas", { modo: "preco", preco: 150 });
    expect(f.json).toEqual({ preco: 150, margemVenda: null, custo: 100, margem: expect.closeTo(33.333, 2), markup: 50 });
    expect(prod("pGas")).toMatchObject({ valorPadrao: 150, margemVenda: null });
  });

  it("API recusa: margem 100%, sem custo, preço zero, campo a mais (empresa, preço junto da margem)", async () => {
    for (const corpo of [
      { modo: "margem", margem: 100, custoBase: 100 }, { modo: "margem", margem: 30, custoBase: 0 }, { modo: "margem", margem: 30 },
      { modo: "preco", preco: 0 }, { modo: "preco", preco: 150, empresaId: "e2" }, { modo: "margem", margem: 30, custoBase: 100, preco: 1 }, { preco: 150 },
    ]) expect((await precoApi("pGas", corpo)).status).toBe(400);
    expect(prod("pGas")).toMatchObject({ valorPadrao: null, margemVenda: null });
  });

  it("página do produto no Estoque: custo da última compra, preço, margem e markup — e quem não pode editar só vê", async () => {
    await nota1Lancada();
    await precoApi("pGas", { modo: "margem", margem: 30, custoBase: 100 });
    const h = await paginaProduto("pGas");
    const t = texto(h);
    expect(h).toContain('data-card-preco');
    expect(t).toMatch(/Custo R\$ 100,00 Último custo de compra · por kg/);
    expect(t).toMatch(/Preço R\$ 142,86/);
    expect(t).toMatch(/Margem 30,0% sobre a venda/);
    expect(t).toMatch(/Markup 42,9% sobre o custo/);
    expect(t).toContain("definido por margem de 30,0% sobre a venda");
    expect(h).toContain("data-salvar-preco");
    logar(so({ estoque: { visualizar: true, gerenciar: true } }));
    const leitura = await paginaProduto("pGas");
    expect(leitura).not.toContain("data-salvar-preco");
    expect(texto(leitura)).toContain("Para mudar o preço, precisa de Configurações › gerenciar");
  });
});

// ═════════════════════════ Custo mudou → só avisa ═════════════════════════
describe("custo mudou numa nova NF: só avisa, nunca muda o preço", () => {
  const TEXTO = "O custo mudou: era R$ 100,00/kg, nesta nota R$ 105,00/kg (+5,0%). Seu preço atual (R$ 142,86) dá 26,5% de margem agora (antes 30,0%). Para manter 30,0%, o preço seria R$ 150,00. O preço não foi alterado.";

  async function cenario() {
    await nota1Lancada();
    await precoApi("pGas", { modo: "margem", margem: 30, custoBase: 100 });
    return (await importar(XML2)).json.nota.id as string;
  }

  it("na conciliação: aviso com a margem que o preço atual dá agora (e o preço que manteria a margem alvo)", async () => {
    const id2 = await cenario();
    const h = await detalhe(id2);
    expect(h).toContain('data-aviso-custo="1"');
    expect(texto(h)).toContain(TEXTO);
    expect(texto(h)).toMatch(/Preço de venda: R\$ 142,86 margem com o custo desta nota: 26,5%/);
    expect(h).toContain('data-ajustar-preco="1"'); // ajustar é opcional e só com clique
    expect(prod("pGas")).toMatchObject({ valorPadrao: 142.86, margemVenda: 30 });
  });

  it("ao lançar: o aviso volta na resposta e no resultado; preço e margem alvo continuam os mesmos", async () => {
    const id2 = await cenario();
    const r = await lancarApi(id2);
    expect(r.json.avisosCusto).toEqual([expect.objectContaining({
      produtoId: "pGas", custoAnterior: 100, custoNovo: 105, preco: 142.86, margemAlvo: 30, precoParaManter: 150,
    })]);
    expect(sp(r.json.avisosCusto[0].texto)).toBe(TEXTO);
    expect(r.json.avisosCusto[0].margemAgora).toBeCloseTo(26.5, 1);
    expect(prod("pGas")).toMatchObject({ valorPadrao: 142.86, margemVenda: 30 });
    const h = await detalhe(id2);
    expect(h).toContain("data-avisos-custo");
    expect(texto(h)).toContain(TEXTO);
  });

  it("custo igual ao anterior, ou primeira compra: sem aviso", async () => {
    const { r } = await nota1Lancada();
    expect(r.json.avisosCusto).toEqual([]); // 1ª compra do gás; a válvula nunca teve custo
    expect(avisoCusto({ produtoId: "p", produto: "P", unidade: "kg", custoAnterior: 100, custoNovo: 100, preco: 150, margemAlvo: null })).toBeNull();
    expect(avisoCusto({ produtoId: "p", produto: "P", unidade: "kg", custoAnterior: null, custoNovo: 100, preco: 150, margemAlvo: null })).toBeNull();
    const semPreco = avisoCusto({ produtoId: "p", produto: "P", unidade: "kg", custoAnterior: 100, custoNovo: 90, preco: null, margemAlvo: null })!;
    expect(sp(semPreco.texto)).toBe("O custo mudou: era R$ 100,00/kg, nesta nota R$ 90,00/kg (−10,0%). O produto ainda não tem preço de venda. O preço não foi alterado.");
  });
});

// ═════════════════════════ Dados fiscais ═════════════════════════
describe("dados fiscais do XML", () => {
  it("o leitor pega NCM, CEST, GTIN (cEAN ou cEANTrib), origem (qualquer grupo de ICMS) e unidade tributável", () => {
    const [gas, val] = lerNfe(XML1).itens;
    expect(gas).toMatchObject({ ncm: "29037990", cest: "0100100", ean: "7891234500017", origem: "1", unidadeTributavel: "KG", unidade: "UN" });
    expect(val).toMatchObject({ ncm: "84818099", cest: null, ean: "7891234500024", origem: "0", unidadeTributavel: "PC" }); // ICMSSN102
  });

  it("produto NOVO criado pela NF recebe NCM, CEST, GTIN, origem e unidade tributável", async () => {
    const id = (await importar(XML1)).json.nota.id;
    const [gas] = itensDa(id);
    await conciliarApi(id, [{ itemId: gas.id, novo: { nome: "Gás R404A cilindro", unidade: "kg" }, fator: 13.6 }]);
    const novo = T("produto").find((p) => p.nome === "Gás R404A cilindro");
    expect(novo).toMatchObject({ empresaId: "e1", unidade: "kg", ncm: "29037990", cest: "0100100", gtin: "7891234500017", origemMercadoria: "1", unidadeTributavel: "KG" });
    expect(gas.fatorConversao).toBe(13.6);
  });

  it("produto EXISTENTE: preenche só o vazio; o que já tem fica — e se a nota diz outra coisa, avisa", async () => {
    const { id } = await nota1Lancada();
    // gás estava vazio: tudo vem da nota
    expect(prod("pGas")).toMatchObject({ ncm: "29037990", cest: "0100100", gtin: "7891234500017", origemMercadoria: "1", unidadeTributavel: "KG" });
    // válvula: NCM igual e CEST próprio ficam; GTIN, origem e un. trib. (vazios) vêm da nota
    expect(prod("pVal")).toMatchObject({ ncm: "84818099", cest: "9999999", gtin: "7891234500024", origemMercadoria: "0", unidadeTributavel: "PC" });
    expect(T("movimentacaoEstoque").length).toBeGreaterThan(0);
    // 2ª nota com OUTRO NCM para o gás: aviso na conciliação e no lançamento; o cadastro mantém o seu
    const id2 = (await importar(XML2)).json.nota.id;
    const h = await detalhe(id2);
    expect(texto(h)).toContain("NCM: cadastro 29037990 · nota 38247800 (fica o do cadastro)");
    const r = await lancarApi(id2);
    expect(r.json.avisos).toEqual(["Gás R404A: NCM do cadastro (29037990) é diferente da nota (38247800) — mantido o do cadastro."]);
    expect(prod("pGas").ncm).toBe("29037990");
    expect(id).not.toBe(id2);
  });

  it("os itens da nota guardam os fiscais do XML (CEST, GTIN, origem, un. trib.)", async () => {
    const id = (await importar(XML1)).json.nota.id;
    expect(itensDa(id).map((i) => [i.ncm, i.cest, i.gtin, i.origem, i.unidadeTributavel])).toEqual([
      ["29037990", "0100100", "7891234500017", "1", "KG"],
      ["84818099", null, "7891234500024", "0", "PC"],
    ]);
  });
});

// ═════════════════════════ Empresa e permissão ═════════════════════════
describe("empresa e permissão", () => {
  it("preço: produto de outra empresa = 404 (nada muda); sem Configurações › gerenciar = 403", async () => {
    const r = await precoApi("pB", { modo: "preco", preco: 99 });
    expect(r.status).toBe(404);
    expect(prod("pB").valorPadrao).toBe(10);
    logar(so({ estoque: { visualizar: true, gerenciar: true } }));
    expect((await precoApi("pGas", { modo: "preco", preco: 99 })).status).toBe(403);
    logar(permissoesTotais(), "e2");
    expect((await precoApi("pGas", { modo: "preco", preco: 99 })).status).toBe(404);
    expect(prod("pGas").valorPadrao).toBeNull();
  });

  it("busca de produto do de-para traz preço, margem alvo, custo e fiscais — só da empresa da sessão", async () => {
    await nota1Lancada();
    await precoApi("pGas", { modo: "margem", margem: 30, custoBase: 100 });
    const r = await buscarApi("gás");
    expect(r.json.produtos).toEqual([expect.objectContaining({
      id: "pGas", unidade: "kg", preco: 142.86, margemVenda: 30, custo: 100,
      fiscal: { ncm: "29037990", cest: "0100100", gtin: "7891234500017", origemMercadoria: "1", unidadeTributavel: "KG" },
    })]);
    logar(permissoesTotais(), "e2");
    expect((await buscarApi("gás")).json.produtos.map((p: { id: string }) => p.id)).toEqual(["pB"]);
  });

  it("conciliar com fator a nota de outra empresa = 404; produto de outra empresa = 400", async () => {
    const id = (await importar(XML1)).json.nota.id;
    const [gas] = itensDa(id);
    expect((await conciliarApi(id, [{ itemId: gas.id, produtoId: "pB", fator: 13.6 }])).status).toBe(400);
    logar(permissoesTotais(), "e2");
    expect((await conciliarApi(id, [{ itemId: gas.id, produtoId: "pB", fator: 13.6 }])).status).toBe(404);
    expect(gas).toMatchObject({ produtoId: null, fatorConversao: 1 });
  });
});
