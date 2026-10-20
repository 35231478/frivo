/**
 * Estoque E2.1 — conciliação de NF completa (central de lançamento, estilo ContaAzul). Rotas e telas
 * reais, banco em memória (DUAS empresas), fixtures de NF-e 4.00 da Frigelar (nfe-4521: 3 itens, 3
 * duplicatas, boleto no pag/tPag; nfe-4610: mesmo fornecedor, sem duplicata, dinheiro). Prova:
 *  - forma de pagamento do pag/tPag do XML (nome amigável + forma da conta), editável;
 *  - rascunho editável até "Confirmar e lançar": categoria, centro de custo, forma, parcelas (valor,
 *    vencimento, boleto de cada uma) e preço de venda NA LINHA — tudo gravado só no rascunho;
 *  - lançar: as contas a pagar saem das parcelas do rascunho (padrão = duplicatas), com categoria,
 *    centro, forma e boleto; soma ≠ nota só avisa; o preço da linha vai para o produto;
 *  - aprendizado por fornecedor: categoria e centro de custo da 1ª nota vêm na próxima (ajustáveis);
 *  - centro de custo: cadastro no padrão (criar/editar/inativar/reativar, nome único, impacto, ações em
 *    massa) e usado em TODA conta a pagar (manual também), com o boleto e o detalhe da conta;
 *  - atalho "Lançar a partir de NF" em Contas a pagar → a mesma importação;
 *  - empresa sempre da sessão e permissões (Estoque › gerenciar; + Financeiro › fluxo de caixa para o
 *    financeiro e para lançar; + Configurações › gerenciar para preço).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { descricaoTPag, formaDaNota, lerNfe, TPAG } from "@/lib/compras/nfe";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const por = (T: (m: string) => any[], m: string, id: string | null | undefined) => T(m).find((x) => x.id === id) ?? null;
  const quando = (r: any) => r.data ?? new Date(Date.UTC(2020, 0, 1) + Number(String(r.id).split("-").pop()) * 60_000);
  return {
    prisma: criarPrisma(db, {
      notaCompra: (n, T) => ({
        criadoEm: n.criadoEm ?? new Date("2026-11-05T12:00:00Z"),
        fornecedor: por(T, "fornecedor", n.fornecedorId),
        categoria: por(T, "categoriaFinanceira", n.categoriaId),
        centroCusto: por(T, "centroCusto", n.centroCustoId),
        itens: T("notaCompraItem").filter((i) => i.notaId === n.id).map((i) => ({ ...i, produto: por(T, "produto", i.produtoId) })),
        contasPagar: T("contaPagar").filter((c) => c.notaCompraId === n.id),
        pedidoCompra: por(T, "pedidoCompraInterno", n.pedidoCompraId),
        usuario: por(T, "usuario", n.usuarioId),
        _count: { itens: T("notaCompraItem").filter((i) => i.notaId === n.id).length },
      }),
      notaCompraItem: (i, T) => ({ produto: por(T, "produto", i.produtoId), nota: por(T, "notaCompra", i.notaId) }),
      fornecedor: (f, T) => ({ categoriaPadrao: por(T, "categoriaFinanceira", f.categoriaPadraoId), centroCustoPadrao: por(T, "centroCusto", f.centroCustoPadraoId) }),
      contaPagar: (c, T) => ({
        centroCusto: por(T, "centroCusto", c.centroCustoId), notaCompra: por(T, "notaCompra", c.notaCompraId),
        pedidoCompra: por(T, "pedidoCompraInterno", c.pedidoCompraId), fornecedorCadastro: por(T, "fornecedor", c.fornecedorId),
        categoriaFinanceira: por(T, "categoriaFinanceira", c.categoriaId), pagamentos: [],
      }),
      centroCusto: (c, T) => ({ _count: { contasPagar: T("contaPagar").filter((x) => x.centroCustoId === c.id).length } }),
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
/** Estoque + Financeiro, sem Configurações (não mexe em preço) */
const SEM_PRECO = () => so({ estoque: { visualizar: true, gerenciar: true }, financeiro: { visualizar: true, fluxoCaixa: true } });

const FIX = (f: string) => readFileSync(path.resolve(__dirname, "fixtures/nfe", f), "utf8");
const XML1 = FIX("nfe-4521-frigelar.xml"); // gás 2 UN × 689,90 · capacitor 10 PC × 18,45 · tubo 15 M; 3 duplicatas de 583,10; tPag 15
const XML2 = FIX("nfe-4610-frigelar.xml"); // mesmo fornecedor: gás 1 UN × 702,50 + filtro novo; sem duplicata; tPag 01
const CHAVE1 = "35261011222333000181550010000045211000045217";
const ANO = new Date().getFullYear();
// Boletos reais (vetores independentes — ver boleto.test.ts)
const BOLETO_CAIXA = { linha: "10492006506100010004200997263900989810000021403", barras: "10499898100000214032006561000100040099726390" };
const BOLETO_ITAU = { linha: "34192220090000556638551012140003679060000100000", barras: "34196790600001000002220000005566385101214000" };
const trocar = (s: string, pos: number) => s.slice(0, pos) + ((Number(s[pos]) + 1) % 10) + s.slice(pos + 1);

function semear() {
  db.escritas = [];
  db.t = {
    empresa: [{ id: "e1", cnpj: "12.345.678/0001-90" }, { id: "e2", cnpj: "99888777000166" }],
    usuario: [{ id: "u1", nome: "Ana" }],
    fornecedor: [{ id: "fB", empresaId: "e2", nome: "Frigelar (da outra)", documento: "11222333000181", ativo: true }],
    produto: [
      { id: "pGas", empresaId: "e1", nome: "Gás R410A 11,35 kg", unidade: "un", saldo: 0, ativo: true, valorPadrao: 950, margemVenda: null },
      { id: "pCap", empresaId: "e1", nome: "Capacitor 35uF", unidade: "pc", saldo: 0, ativo: true, valorPadrao: 38.9, margemVenda: null },
      { id: "pB", empresaId: "e2", nome: "Produto da outra", unidade: "un", saldo: 0, ativo: true },
    ],
    categoriaFinanceira: [
      { id: "catMat", empresaId: "e1", nome: "Materiais e peças", cor: "#0EA5E9", ativo: true },
      { id: "catGas", empresaId: "e1", nome: "Gases", cor: "#22C55E", ativo: true },
      { id: "catVelha", empresaId: "e1", nome: "Antiga", cor: "#64748B", ativo: false },
      { id: "catB", empresaId: "e2", nome: "Da outra", cor: "#64748B", ativo: true },
    ],
    centroCusto: [
      { id: "ccObra", empresaId: "e1", nome: "Obra Shopping Norte", ativo: true },
      { id: "ccFrota", empresaId: "e1", nome: "Frota", ativo: true },
      { id: "ccVelho", empresaId: "e1", nome: "Obra encerrada", ativo: false },
      { id: "ccB", empresaId: "e2", nome: "Centro da outra", ativo: true },
    ],
    notaCompra: [], notaCompraItem: [], deParaProdutoFornecedor: [], movimentacaoEstoque: [],
    contaPagar: [{ id: "cp-antiga", empresaId: "e1", numero: `CP-${ANO}-0007`, fornecedor: "X", descricao: "Antiga", valorTotal: 10, valorPago: 0, saldoRestante: 10, status: "PENDENTE", notaCompraId: null, pedidoCompraId: null }],
    pedidoCompraInterno: [{ id: "ped1", empresaId: "e1", numero: "PC-0312" }],
    pedidoCompraItem: [],
  };
}
beforeEach(() => { semear(); logar(); });
// Carrega (compila) rotas e telas uma vez, fora do tempo de cada teste
beforeAll(async () => {
  await Promise.all([
    import("@/app/api/compras/notas/route"), import("@/app/api/compras/notas/[id]/conciliacao/route"), import("@/app/api/compras/notas/[id]/lancar/route"),
    import("@/app/api/cadastros/[entidade]/route"), import("@/app/api/contas-pagar/route"), import("@/app/(dashboard)/estoque/notas/[id]/page"),
    import("@/app/(dashboard)/financeiro/contas-pagar/page"), import("@/app/(dashboard)/financeiro/contas-pagar/[id]/page"), import("@/app/(dashboard)/estoque/notas/page"),
  ]);
}, 120_000);

const T = (m: string) => (db.t as any)[m] as any[];
const prod = (id: string) => T("produto").find((p) => p.id === id);
const nota = (id: string) => T("notaCompra").find((n) => n.id === id);
const forn = () => T("fornecedor").find((f) => f.empresaId === "e1" && f.documento === "11222333000181");
async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await carregar();
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const importar = (xml: string) => chamar(() => import("@/app/api/compras/notas/route"), "POST", {}, { xml });
const rascunhoApi = (id: string, corpo: unknown) => chamar(() => import("@/app/api/compras/notas/[id]/conciliacao/route"), "PUT", { id }, corpo);
const lancarApi = (id: string, corpo: unknown = {}) => chamar(() => import("@/app/api/compras/notas/[id]/lancar/route"), "POST", { id }, corpo);
const cadastroApi = (metodo: string, corpo?: unknown, id?: string, qs = "") => id
  ? chamar(() => import("@/app/api/cadastros/[entidade]/[id]/route"), metodo, { entidade: "centros-custo", id }, corpo)
  : chamar(() => import("@/app/api/cadastros/[entidade]/route"), metodo, { entidade: "centros-custo" }, corpo, `http://localhost/api/cadastros/centros-custo${qs}`);
const contaApi = (metodo: string, corpo?: unknown, id?: string) => id
  ? chamar(() => import("@/app/api/contas-pagar/[id]/route"), metodo, { id }, corpo)
  : chamar(() => import("@/app/api/contas-pagar/route"), metodo, {}, corpo);
const itensDa = (notaId: string) => T("notaCompraItem").filter((i) => i.notaId === notaId).sort((a, b) => a.numeroItem - b.numeroItem);
const contasDa = (notaId: string) => T("contaPagar").filter((c) => c.notaCompraId === notaId);
const render = async (carregar: () => Promise<any>, props: unknown) => { const { default: P } = await carregar(); return renderToStaticMarkup(await P(props)); };
const detalheNota = (id: string, de?: string) => render(() => import("@/app/(dashboard)/estoque/notas/[id]/page"), { params: Promise.resolve({ id }), searchParams: Promise.resolve(de ? { de } : {}) });
const listaNotas = (de?: string) => render(() => import("@/app/(dashboard)/estoque/notas/page"), { searchParams: Promise.resolve(de ? { de } : {}) });
const listaContas = (sp: Record<string, string> = {}) => render(() => import("@/app/(dashboard)/financeiro/contas-pagar/page"), { searchParams: Promise.resolve(sp) });
const detalheConta = (id: string) => render(() => import("@/app/(dashboard)/financeiro/contas-pagar/[id]/page"), { params: Promise.resolve({ id }) });
/** Texto da tela: tags viram espaço (e o espaço antes de pontuação some: "<strong>X</strong>: y" = "X: y") */
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").replace(/ ([:.,)])/g, "$1");
const sp = (s: string) => s.replace(/ /g, " ");

/** Itens da NF 4521: gás → pGas, capacitor → pCap (PC = pc), tubo → produto novo */
const escolhas = (id: string, extra: Record<number, Record<string, unknown>> = {}) => {
  const [gas, cap, tubo] = itensDa(id);
  return [
    { itemId: gas.id, produtoId: "pGas", fator: 1, ...extra[1] },
    { itemId: cap.id, produtoId: "pCap", fator: 1, ...extra[2] },
    { itemId: tubo.id, novo: { nome: "Tubo de cobre 1/4" }, ...extra[3] },
  ];
};
const nota1 = async () => (await importar(XML1)).json.nota.id as string;

// ═════════════════════════ Forma de pagamento (pag/tPag) ═════════════════════════
describe("forma de pagamento do XML (pag/detPag/tPag)", () => {
  it("o leitor pega cada detPag: tPag, nome amigável, valor e à vista/a prazo", () => {
    expect(lerNfe(XML1).pagamentos).toEqual([{ tPag: "15", descricao: "Boleto bancário", valor: 1749.3, aPrazo: true }]);
    expect(lerNfe(XML2).pagamentos).toEqual([{ tPag: "01", descricao: "Dinheiro", valor: 829.1, aPrazo: false }]);
    const doisPags = XML1.replace(/<pag>[\s\S]*<\/pag>/, "<pag><detPag><tPag>3</tPag><vPag>300.00</vPag></detPag><detPag><indPag>1</indPag><tPag>17</tPag><vPag>1449.30</vPag></detPag></pag>");
    expect(lerNfe(doisPags).pagamentos).toEqual([
      { tPag: "03", descricao: "Cartão de crédito", valor: 300, aPrazo: null }, { tPag: "17", descricao: "PIX", valor: 1449.3, aPrazo: true },
    ]);
    expect(lerNfe(XML1.replace(/<pag>[\s\S]*<\/pag>/, "")).pagamentos).toEqual([]);
  });

  it("tPag → forma da conta a pagar (e texto amigável); sem equivalente = a pessoa escolhe", () => {
    const forma = (t: string) => formaDaNota([{ tPag: t, descricao: descricaoTPag(t), valor: 10, aPrazo: null }]);
    expect(["01", "02", "03", "04", "15", "16", "17", "18", "20"].map(forma)).toEqual(["DINHEIRO", "CHEQUE", "CARTAO", "CARTAO", "BOLETO", "TRANSFERENCIA", "PIX", "TRANSFERENCIA", "PIX"]);
    expect(["05", "10", "11", "12", "13", "19", "90", "99", "77"].map(forma)).toEqual(Array(9).fill(null));
    expect([descricaoTPag("04"), descricaoTPag("90"), descricaoTPag("77")]).toEqual(["Cartão de débito", "Sem pagamento", "Outra forma (código 77)"]);
    expect(Object.keys(TPAG)).toHaveLength(17);
    // várias formas: vale a de MAIOR valor que tem equivalente
    expect(formaDaNota([{ tPag: "17", descricao: "", valor: 300, aPrazo: null }, { tPag: "15", descricao: "", valor: 1449.3, aPrazo: null }])).toBe("BOLETO");
    expect(formaDaNota([{ tPag: "05", descricao: "", valor: 1000, aPrazo: null }, { tPag: "17", descricao: "", valor: 749.3, aPrazo: null }])).toBe("PIX");
    expect(formaDaNota([])).toBeNull();
  });

  it("importar: a forma da nota já vem do XML (boleto; PIX; sem pagamento = vazia)", async () => {
    const id = await nota1();
    expect(nota(id)).toMatchObject({ formaPagamento: "BOLETO", categoriaId: null, centroCustoId: null });
    semear();
    const pix = (await importar(XML1.replace("<tPag>15</tPag>", "<tPag>17</tPag>"))).json.nota;
    expect(pix.formaPagamento).toBe("PIX");
    semear();
    expect((await importar(XML1.replace("<tPag>15</tPag>", "<tPag>90</tPag>"))).json.nota.formaPagamento).toBeNull();
  });

  it("a central mostra o que a NF diz e a forma escolhida (editável)", async () => {
    const id = await nota1();
    const h = await detalheNota(id);
    expect(sp(texto(h))).toContain("Na NF: 15 · Boleto bancário · R$ 1.749,30 (a prazo)");
    expect(h).toMatch(/<option value="BOLETO" selected="">Boleto<\/option>/);
    expect(h).toContain("<option value=\"PIX\">PIX</option>");
  });
});

// ═════════════════════════ Rascunho ═════════════════════════
describe("rascunho editável (nada é lançado antes de confirmar)", () => {
  it("salvar rascunho grava categoria, centro, forma e parcelas — sem estoque nem conta a pagar", async () => {
    const id = await nota1();
    const parcelas = [
      { duplicata: null, vencimento: "2026-11-20", valor: 874.65, boleto: "10492.00650 61000.100042 00997.263900 9 89810000021403" },
      { duplicata: null, vencimento: "2026-12-20", valor: 874.65, boleto: null },
    ];
    const r = await rascunhoApi(id, { itens: escolhas(id), financeiro: { categoriaId: "catMat", centroCustoId: "ccObra", formaPagamento: "PIX", parcelas } });
    expect(r).toMatchObject({ status: 200, json: { status: "CONCILIADA", faltam: 0 } });
    expect(nota(id)).toMatchObject({
      categoriaId: "catMat", centroCustoId: "ccObra", formaPagamento: "PIX",
      parcelas: [{ ...parcelas[0], boleto: BOLETO_CAIXA.linha }, parcelas[1]], // boleto: só os dígitos da linha
    });
    expect(T("movimentacaoEstoque")).toEqual([]);
    expect(contasDa(id)).toEqual([]);
    // voltar às duplicatas da NF: parcelas null
    await rascunhoApi(id, { itens: [], financeiro: { parcelas: null } });
    expect(nota(id).parcelas).toBeNull();
    expect(nota(id)).toMatchObject({ categoriaId: "catMat", centroCustoId: "ccObra" }); // o que não veio não muda
  });

  it("recusa: categoria/centro de outra empresa, escolha NOVA inativa, parcela sem valor/data, boleto com DV errado, campo a mais", async () => {
    const id = await nota1();
    const fin = (f: Record<string, unknown>) => rascunhoApi(id, { itens: [], financeiro: f });
    expect(await fin({ categoriaId: "catB" })).toMatchObject({ status: 400, json: { erro: "Categoria financeira inválido(a)." } });
    expect(await fin({ centroCustoId: "ccB" })).toMatchObject({ status: 400, json: { erro: "Centro de custo inválido(a)." } });
    expect(await fin({ centroCustoId: "ccVelho" })).toMatchObject({ status: 400, json: { erro: "Centro de custo inativo(a): escolha um(a) ativo(a)." } });
    expect(await fin({ categoriaId: "catVelha" })).toMatchObject({ status: 400 });
    const p = (x: Record<string, unknown>) => ({ duplicata: null, vencimento: "2026-11-20", valor: 100, boleto: null, ...x });
    expect(await fin({ parcelas: [p({}), p({ valor: 0 })] })).toMatchObject({ status: 400, json: { erro: "Parcela 2: Toda parcela precisa de valor maior que zero." } });
    expect(await fin({ parcelas: [p({ vencimento: "2026-02-30" })] })).toMatchObject({ status: 400, json: { erro: "Parcela 1: Vencimento inválido." } });
    expect((await fin({ parcelas: [p({ boleto: trocar(BOLETO_CAIXA.linha, 3) })] })).json.erro).toMatch(/^Parcela 1: Dígito verificador não confere no campo 1/);
    expect((await fin({ parcelas: [] })).json.erro).toBe("A nota precisa de ao menos uma parcela.");
    expect((await fin({ parcelas: Array(121).fill(p({})) })).json.erro).toBe("No máximo 120 parcelas.");
    expect((await fin({ empresaId: "e2" })).status).toBe(400);
    expect(nota(id)).toMatchObject({ categoriaId: null, centroCustoId: null });
    expect(nota(id).parcelas ?? null).toBeNull(); // nada foi gravado
    // manter um centro que JÁ estava no rascunho, mesmo inativado depois, é aceito
    await fin({ centroCustoId: "ccFrota" });
    T("centroCusto").find((c) => c.id === "ccFrota").ativo = false;
    expect((await fin({ centroCustoId: "ccFrota" })).status).toBe(200);
  });

  it("sem Financeiro › fluxo de caixa: o financeiro do rascunho é recusado (403); os itens, não", async () => {
    const id = await nota1();
    logar(so({ estoque: { visualizar: true, gerenciar: true } }));
    const r = await rascunhoApi(id, { itens: escolhas(id), financeiro: { categoriaId: "catMat" } });
    expect(r).toMatchObject({ status: 403, json: { erro: expect.stringMatching(/precisa de Financeiro › fluxo de caixa/) } });
    expect(nota(id).categoriaId).toBeNull();
    expect((await rascunhoApi(id, { itens: escolhas(id) })).status).toBe(200);
    // a tela: financeiro só leitura, com o motivo
    const h = await detalheNota(id);
    expect(h).toContain("só quem tem Financeiro › fluxo de caixa altera");
    expect(h).toMatch(/<select[^>]*name="formaPagamento"[^>]*disabled=""|<select[^>]*disabled=""[^>]*name="formaPagamento"/);
  });
});

// ═════════════════════════ Lançar ═════════════════════════
describe("confirmar e lançar: as contas saem do rascunho", () => {
  it("2 parcelas ajustadas (valor e vencimento), boleto na 1ª, categoria, centro e forma → 2 contas a pagar certas", async () => {
    const id = await nota1();
    const parcelas = [
      { duplicata: null, vencimento: "2026-11-20", valor: 874.65, boleto: BOLETO_CAIXA.linha },
      { duplicata: null, vencimento: "2026-12-20", valor: 874.65, boleto: null },
    ];
    await rascunhoApi(id, { itens: escolhas(id), financeiro: { categoriaId: "catMat", centroCustoId: "ccObra", formaPagamento: "BOLETO", parcelas } });
    const r = await lancarApi(id);
    expect(r.status).toBe(201);
    expect(r.json.contas.map((c: any) => [c.valor, c.boleto])).toEqual([[874.65, true], [874.65, false]]);
    const cs = contasDa(id);
    expect(cs.map((c) => [c.numero, c.valorTotal, c.dataVencimento.toISOString(), c.descricao, c.categoriaId, c.centroCustoId, c.formaPagamento, c.linhaDigitavel, c.codigoBarrasBoleto])).toEqual([
      [`CP-${ANO}-0008`, 874.65, "2026-11-20T12:00:00.000Z", "NF 4521/1 — parcela 1/2", "catMat", "ccObra", "BOLETO", BOLETO_CAIXA.linha, BOLETO_CAIXA.barras],
      [`CP-${ANO}-0009`, 874.65, "2026-12-20T12:00:00.000Z", "NF 4521/1 — parcela 2/2", "catMat", "ccObra", "BOLETO", null, null],
    ]);
    expect(cs[0].observacao).toBe(`Parcela 1/2 da NF-e ${CHAVE1} (parcelas ajustadas no lançamento)`);
    expect(cs.every((c) => c.status === "PENDENTE" && c.saldoRestante === c.valorTotal && c.fornecedorId === forn().id)).toBe(true);
    expect(T("movimentacaoEstoque")).toHaveLength(3); // tudo na mesma transação
    expect(nota(id).status).toBe("LANCADA");
  });

  it("o financeiro que está na tela na hora de confirmar vale (gravado no rascunho e usado)", async () => {
    const id = await nota1();
    const r = await lancarApi(id, { itens: escolhas(id), financeiro: { categoriaId: "catGas", centroCustoId: "ccFrota", formaPagamento: "PIX", parcelas: [{ duplicata: "001", vencimento: "2026-11-14", valor: 1749.3, boleto: BOLETO_ITAU.barras }] } });
    expect(r.status).toBe(201);
    expect(contasDa(id).map((c) => [c.valorTotal, c.categoriaId, c.centroCustoId, c.formaPagamento, c.linhaDigitavel, c.codigoBarrasBoleto, c.descricao, c.observacao])).toEqual([
      [1749.3, "catGas", "ccFrota", "PIX", BOLETO_ITAU.linha, BOLETO_ITAU.barras, "NF 4521/1", `Duplicata 001 da NF-e ${CHAVE1}`],
    ]);
    expect(nota(id)).toMatchObject({ categoriaId: "catGas", centroCustoId: "ccFrota", formaPagamento: "PIX" });
  });

  it("sem rascunho de parcelas: seguem as duplicatas da NF, com a forma do XML; sem duplicata = à vista", async () => {
    const id = await nota1();
    await lancarApi(id, { itens: escolhas(id) });
    expect(contasDa(id).map((c) => [c.valorTotal, c.dataVencimento.toISOString().slice(0, 10), c.formaPagamento, c.observacao])).toEqual([
      [583.1, "2026-11-14", "BOLETO", `Duplicata 001 da NF-e ${CHAVE1}`],
      [583.1, "2026-12-14", "BOLETO", `Duplicata 002 da NF-e ${CHAVE1}`],
      [583.1, "2027-01-13", "BOLETO", `Duplicata 003 da NF-e ${CHAVE1}`],
    ]);
    const id2 = (await importar(XML2)).json.nota.id;
    const [, filtro] = itensDa(id2);
    await lancarApi(id2, { itens: [{ itemId: filtro.id, novo: { nome: "Filtro secador 032S" } }] });
    const [avista] = contasDa(id2);
    expect([avista.valorTotal, avista.dataVencimento.toISOString(), avista.formaPagamento, avista.observacao])
      .toEqual([829.1, "2026-11-03T12:00:00.000Z", "DINHEIRO", `Parcela única da NF-e ${lerNfe(XML2).chave} (à vista)`]);
  });

  it("soma das parcelas ≠ valor da nota: lança assim mesmo, seguindo as parcelas (o aviso é na tela)", async () => {
    const id = await nota1();
    const parcelas = [500, 500, 700].map((valor, k) => ({ duplicata: null, vencimento: `2026-1${k}-10`.replace("-10-10", "-10-10"), valor, boleto: null }));
    parcelas[0].vencimento = "2026-10-30"; parcelas[1].vencimento = "2026-11-30"; parcelas[2].vencimento = "2026-12-30";
    const r = await lancarApi(id, { itens: escolhas(id), financeiro: { parcelas } });
    expect(r.status).toBe(201);
    expect(contasDa(id).map((c) => c.valorTotal)).toEqual([500, 500, 700]);
  });

  it("financeiro de outra empresa no lançamento: 400 e a nota NÃO é lançada; nota de outra empresa: 404", async () => {
    const id = await nota1();
    expect(await lancarApi(id, { itens: escolhas(id), financeiro: { centroCustoId: "ccB" } })).toMatchObject({ status: 400, json: { erro: "Centro de custo inválido(a)." } });
    logar(permissoesTotais(), "e2");
    expect((await lancarApi(id, { itens: [] })).status).toBe(404);
    expect((await rascunhoApi(id, { itens: [], financeiro: { categoriaId: "catB" } })).status).toBe(404);
  });
});

// ═════════════════════════ Aprendizado por fornecedor ═════════════════════════
describe("aprendizado por fornecedor: categoria e centro de custo", () => {
  it("1ª nota: a pessoa escolhe; ao lançar o fornecedor aprende; a 2ª nota já vem com eles (e a tela marca)", async () => {
    const id = await nota1();
    expect(nota(id)).toMatchObject({ categoriaId: null, centroCustoId: null });
    await lancarApi(id, { itens: escolhas(id), financeiro: { categoriaId: "catMat", centroCustoId: "ccObra" } });
    expect(forn()).toMatchObject({ categoriaPadraoId: "catMat", centroCustoPadraoId: "ccObra" });
    const id2 = (await importar(XML2)).json.nota.id;
    expect(nota(id2)).toMatchObject({ categoriaId: "catMat", centroCustoId: "ccObra", formaPagamento: "DINHEIRO" });
    const h = await detalheNota(id2);
    expect(h).toContain("data-padrao-categoria");
    expect(h).toContain("data-padrao-centro");
    expect(texto(h)).toContain("padrão deste fornecedor");
  });

  it("ajustável: escolher outro na 2ª nota muda o aprendido; escolher 'nenhum' não apaga o que já aprendeu", async () => {
    const id = await nota1();
    await lancarApi(id, { itens: escolhas(id), financeiro: { categoriaId: "catMat", centroCustoId: "ccObra" } });
    const id2 = (await importar(XML2)).json.nota.id;
    const [, filtro] = itensDa(id2);
    await lancarApi(id2, { itens: [{ itemId: filtro.id, novo: { nome: "Filtro" } }], financeiro: { categoriaId: null, centroCustoId: "ccFrota" } });
    expect(contasDa(id2)[0]).toMatchObject({ categoriaId: null, centroCustoId: "ccFrota" });
    expect(forn()).toMatchObject({ categoriaPadraoId: "catMat", centroCustoPadraoId: "ccFrota" });
  });

  it("padrão inativado depois NÃO é pré-preenchido; padrão de outra empresa nunca aparece", async () => {
    const id = await nota1();
    await lancarApi(id, { itens: escolhas(id), financeiro: { categoriaId: "catMat", centroCustoId: "ccObra" } });
    T("centroCusto").find((c) => c.id === "ccObra").ativo = false;
    const id2 = (await importar(XML2)).json.nota.id;
    expect(nota(id2)).toMatchObject({ categoriaId: "catMat", centroCustoId: null });
    // a outra empresa (filial da mesma raiz do destinatário) tem o mesmo fornecedor (CNPJ) e nada aprendeu
    T("empresa")[1].cnpj = "12345678000271";
    logar(permissoesTotais(), "e2");
    const outra = (await importar(XML1)).json.nota;
    expect(outra).toMatchObject({ categoriaId: null, centroCustoId: null });
  });
});

// ═════════════════════════ Preço de venda na linha ═════════════════════════
describe("preço de venda na linha (rascunho; vai para o produto ao lançar)", () => {
  it("por margem: o rascunho guarda a margem e o preço com o custo DESTA nota; ao lançar vai para o produto", async () => {
    const id = await nota1();
    // gás: 2 UN × 689,90 (produto em "un", fator 1) → custo 689,90; margem 30% sobre a venda → 985,57
    await rascunhoApi(id, { itens: escolhas(id, { 1: { preco: { modo: "margem", margem: 30 } } }) });
    expect(itensDa(id)[0]).toMatchObject({ margemVenda: 30, precoVenda: 985.57 });
    expect(prod("pGas")).toMatchObject({ valorPadrao: 950, margemVenda: null }); // rascunho: o produto ainda não mudou
    const r = await lancarApi(id);
    expect(r.json.precosAplicados).toEqual([{ produtoId: "pGas", produto: "Gás R410A 11,35 kg", precoAnterior: 950, preco: 985.57, margem: 30 }]);
    expect(prod("pGas")).toMatchObject({ valorPadrao: 985.57, margemVenda: 30 });
    expect(prod("pCap")).toMatchObject({ valorPadrao: 38.9, margemVenda: null }); // sem preço na linha: nunca muda sozinho
    const h = await detalheNota(id);
    expect(sp(texto(h))).toContain("Gás R410A 11,35 kg: preço de venda definido nesta nota — R$ 985,57 (margem de 30,0% sobre a venda).");
  });

  it("por margem com conversão (1 UN = 11,35 kg): o preço sai do custo POR KG desta nota", async () => {
    T("produto").push({ id: "pKg", empresaId: "e1", nome: "Gás R410A (kg)", unidade: "kg", saldo: 0, ativo: true, valorPadrao: 90, margemVenda: null });
    const id = await nota1();
    // 689,90 ÷ 11,35 = 60,7841/kg; margem 30% → 60,7841 ÷ 0,7 = 86,83
    await rascunhoApi(id, { itens: escolhas(id, { 1: { produtoId: "pKg", fator: 11.35, preco: { modo: "margem", margem: 30 } } }) });
    expect(itensDa(id)[0]).toMatchObject({ produtoId: "pKg", fatorConversao: 11.35, margemVenda: 30, precoVenda: 86.83 });
    await lancarApi(id);
    expect(prod("pKg")).toMatchObject({ valorPadrao: 86.83, margemVenda: 30, saldo: 22.7 });
  });

  it("preço definido na linha: sem aviso de custo para aquele produto (resposta e resultado); os outros seguem avisando", async () => {
    T("movimentacaoEstoque").push(
      { id: "m-ant-gas", empresaId: "e1", produtoId: "pGas", tipo: "ENTRADA", custoUnitario: 600, origem: "MANUAL", refId: null, data: new Date("2026-01-01T12:00:00Z") },
      { id: "m-ant-cap", empresaId: "e1", produtoId: "pCap", tipo: "ENTRADA", custoUnitario: 15, origem: "MANUAL", refId: null, data: new Date("2026-01-01T12:00:00Z") },
    );
    const id = await nota1();
    const r = await lancarApi(id, { itens: escolhas(id, { 1: { preco: { modo: "preco", preco: 1100 } } }) });
    expect(r.json.avisosCusto.map((a: any) => a.produtoId)).toEqual(["pCap"]); // gás: a pessoa já decidiu o preço
    const h = await detalheNota(id);
    expect(h).toContain("data-avisos-custo");
    const avisos = texto(h.slice(h.indexOf("data-avisos-custo"), h.indexOf("data-avisos-custo") + 2000));
    expect(avisos).toContain("Capacitor 35uF");
    expect(avisos).not.toContain("Gás R410A 11,35 kg —");
  });

  it("preço fixo: grava o preço e limpa a margem alvo; produto NOVO já nasce com o preço da linha", async () => {
    T("produto").find((p) => p.id === "pCap").margemVenda = 40;
    const id = await nota1();
    const r = await lancarApi(id, { itens: escolhas(id, { 2: { preco: { modo: "preco", preco: 39.9 } }, 3: { preco: { modo: "margem", margem: 25 } } }) });
    expect(r.status).toBe(201);
    expect(prod("pCap")).toMatchObject({ valorPadrao: 39.9, margemVenda: null });
    const tubo = T("produto").find((p) => p.nome === "Tubo de cobre 1/4");
    // tubo: 15 M × 12,3333 (185,00) → custo 12,3333/M; margem 25% → 16,44
    expect(tubo).toMatchObject({ unidade: "M", valorPadrao: 16.44, margemVenda: 25 });
  });

  it("trocar o produto do item sem mandar preço tira o rascunho de preço (era de outro produto)", async () => {
    const id = await nota1();
    await rascunhoApi(id, { itens: escolhas(id, { 1: { preco: { modo: "preco", preco: 999 } } }) });
    expect(itensDa(id)[0]).toMatchObject({ precoVenda: 999, margemVenda: null });
    await rascunhoApi(id, { itens: [{ itemId: itensDa(id)[0].id, produtoId: "pCap", fator: 1 }] });
    expect(itensDa(id)[0]).toMatchObject({ produtoId: "pCap", precoVenda: null, margemVenda: null });
    // preço null no corpo = tira também
    await rascunhoApi(id, { itens: escolhas(id, { 1: { preco: { modo: "preco", preco: 999 } } }) });
    await rascunhoApi(id, { itens: escolhas(id, { 1: { preco: null } }) });
    expect(itensDa(id)[0]).toMatchObject({ precoVenda: null, margemVenda: null });
  });

  it("sem Configurações › gerenciar: preço no rascunho = 403; lançar nota com preço salvo = 403 ANTES de tudo", async () => {
    const id = await nota1();
    logar(SEM_PRECO());
    const r = await rascunhoApi(id, { itens: escolhas(id, { 1: { preco: { modo: "preco", preco: 999 } } }) });
    expect(r).toMatchObject({ status: 403, json: { erro: "Definir o preço de venda precisa de Configurações › gerenciar (o mesmo do cadastro de produtos)." } });
    expect(itensDa(id)[0].precoVenda).toBeUndefined();
    logar();
    await rascunhoApi(id, { itens: escolhas(id, { 1: { preco: { modo: "preco", preco: 999 } } }) });
    logar(SEM_PRECO());
    const l = await lancarApi(id);
    expect(l.status).toBe(403);
    expect(l.json.erro).toMatch(/^Esta nota tem preço de venda definido na linha \(GAS REFRIGERANTE R410A CILINDRO 11,35KG\): lançar aplica o preço/);
    expect(nota(id).status).not.toBe("LANCADA");
    expect(T("movimentacaoEstoque")).toEqual([]);
    expect(contasDa(id)).toEqual([]);
    expect(prod("pGas").valorPadrao).toBe(950);
    expect((await lancarApi(id, { itens: escolhas(id, { 1: { preco: null } }) })).status).toBe(403); // nem para tirar
  });

  it("margem impossível (≥ 100%) e preço zero: 400", async () => {
    const id = await nota1();
    expect((await rascunhoApi(id, { itens: escolhas(id, { 1: { preco: { modo: "margem", margem: 100 } } }) })).json.erro).toBe("A margem sobre a venda precisa ser menor que 100%.");
    expect((await rascunhoApi(id, { itens: escolhas(id, { 1: { preco: { modo: "preco", preco: 0 } } }) })).json.erro).toBe("O preço precisa ser maior que zero.");
    expect((await rascunhoApi(id, { itens: escolhas(id, { 1: { preco: { modo: "preco", preco: 10, margem: 5 } } }) })).status).toBe(400);
  });

  it("a linha mostra custo · preço · margem · markup sem precisar clicar (custo desta nota)", async () => {
    const id = await nota1();
    await rascunhoApi(id, { itens: escolhas(id) });
    const h = await detalheNota(id);
    const linha = sp(texto(h.slice(h.indexOf('data-preco-item="1"'), h.indexOf('data-item="2"'))));
    // gás: custo 689,90, preço 950,00 → margem (950 − 689,9) ÷ 950 = 27,4%; markup ÷ 689,9 = 37,7%
    expect(linha).toMatch(/Custo R\$ 689,90 .*Preço R\$ 950,00 .*Margem 27,4% .*Markup 37,7%/);
    // preço fixo hoje: abre no "Preço fixo" (com o preço atual) e dá para trocar para "Por margem" ali mesmo
    expect(h).toMatch(/name="preco"[^>]*value="950,00"|value="950,00"[^>]*name="preco"/);
    expect(h).toContain('data-modo="margem"');
  });
});

// ═════════════════════════ Centro de custo: cadastro ═════════════════════════
describe("centro de custo: cadastro no padrão", () => {
  it("criar (empresa da sessão, ativo) → editar → inativar → reativar; campo a mais = 400; nome repetido = 409", async () => {
    const c = await cadastroApi("POST", { nome: "  Administrativo " });
    expect(c.status).toBe(201);
    expect(c.json).toMatchObject({ nome: "Administrativo", empresaId: "e1", ativo: true });
    expect((await cadastroApi("POST", { nome: "x", empresaId: "e2" })).json.erro).toBe("Campo não permitido: empresaId.");
    expect(await cadastroApi("POST", { nome: "OBRA SHOPPING NORTE" })).toMatchObject({ status: 409, json: { erro: "Já existe o centro de custo “Obra Shopping Norte”." } });
    expect((await cadastroApi("POST", { nome: "obra encerrada" })).json.erro).toBe("Já existe o centro de custo “Obra encerrada” (inativo — reative-o em vez de cadastrar de novo).");
    expect((await cadastroApi("POST", { nome: "" })).status).toBe(400);
    expect((await cadastroApi("PATCH", { nome: "Adm. central" }, c.json.id)).json).toMatchObject({ nome: "Adm. central", ativo: true });
    expect((await cadastroApi("PATCH", { nome: "frota" }, c.json.id)).status).toBe(409);
    expect((await cadastroApi("DELETE", undefined, c.json.id)).status).toBe(200);
    expect(T("centroCusto").find((x) => x.id === c.json.id).ativo).toBe(false); // excluir = inativar (nada é apagado)
    expect((await cadastroApi("PATCH", { ativo: true }, c.json.id)).json.ativo).toBe(true);
    expect(T("centroCusto")).toHaveLength(5);
  });

  it("lista (ativos por padrão, busca, paginado, sugestões) só da empresa; outra empresa = 404", async () => {
    expect((await cadastroApi("GET")).json.map((c: any) => c.nome)).toEqual(["Frota", "Obra Shopping Norte"]);
    expect((await cadastroApi("GET", undefined, undefined, "?ativo=todos&q=obra")).json.map((c: any) => c.id)).toEqual(["ccVelho", "ccObra"]);
    const pag = (await cadastroApi("GET", undefined, undefined, "?ativo=todos&por=25")).json;
    expect([pag.total, pag.contagens]).toEqual([3, { ativos: 2, inativos: 1, todos: 3 }]);
    expect((await cadastroApi("GET", undefined, undefined, "?sugestoes=1&q=fro")).json.sugestoes.map((s: any) => s.id)).toEqual(["ccFrota"]);
    expect((await cadastroApi("GET", undefined, "ccB")).status).toBe(404);
    expect((await cadastroApi("PATCH", { nome: "y" }, "ccB")).status).toBe(404);
  });

  it("permissões: qualquer usuário logado lê (seletores); gravar = Configurações › gerenciar", async () => {
    logar(so({ financeiro: { visualizar: true, fluxoCaixa: true } }));
    expect((await cadastroApi("GET")).status).toBe(200);
    expect((await cadastroApi("POST", { nome: "Novo" })).status).toBe(403);
    expect((await cadastroApi("DELETE", undefined, "ccObra")).status).toBe(403);
    logar(so({ configuracoes: { visualizar: true, gerenciar: true } }));
    expect((await cadastroApi("POST", { nome: "Novo" })).status).toBe(201);
  });

  it("impacto antes de inativar: contas a pagar (em aberto), fornecedores com ele de padrão e notas não lançadas", async () => {
    T("contaPagar").push({ id: "c1", empresaId: "e1", centroCustoId: "ccObra", status: "PENDENTE" }, { id: "c2", empresaId: "e1", centroCustoId: "ccObra", status: "PAGO_TOTAL" });
    T("fornecedor").push({ id: "f9", empresaId: "e1", nome: "F", centroCustoPadraoId: "ccObra" });
    T("notaCompra").push({ id: "n9", empresaId: "e1", centroCustoId: "ccObra", status: "IMPORTADA" });
    const { default: _ } = { default: null };
    const r = await chamar(() => import("@/app/api/cadastros/[entidade]/[id]/impacto/route"), "GET", { entidade: "centros-custo", id: "ccObra" });
    expect(r.json.usos).toEqual([
      { rotulo: "2 contas a pagar", total: 2 }, { rotulo: "1 fornecedor (padrão)", total: 1 }, { rotulo: "1 nota não lançada", total: 1 },
    ]);
    expect(r.json.avisos[0]).toBe("Usado em 2 contas a pagar (1 em aberto). Elas continuam com este centro de custo (aparece como “inativo”); ele só deixa de ser oferecido em contas novas.");
    expect(r.json.avisos.slice(1)).toEqual([
      "É o padrão de 1 fornecedor: as próximas notas deles não vêm mais com ele.",
      "Está em 1 nota de compra ainda não lançada: dá para lançar assim mesmo ou trocar antes.",
    ]);
    void _;
  });

  it("ações em massa: inativar e reativar vários; outra empresa não entra", async () => {
    const { POST } = await import("@/app/api/acoes-massa/route");
    const massa = async (acao: string, ids: string[]) => (await POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", body: JSON.stringify({ entidade: "centros-custo", acao, ids }) }))).json();
    const r = await massa("inativar", ["ccObra", "ccFrota", "ccB"]);
    expect(r.resultados.map((x: any) => x.ok)).toEqual([true, true, false]);
    expect(T("centroCusto").filter((c) => !c.ativo).map((c) => c.id).sort()).toEqual(["ccFrota", "ccObra", "ccVelho"]);
    expect(T("centroCusto").find((c) => c.id === "ccB").ativo).toBe(true);
    expect((await massa("reativar", ["ccObra"])).resultados[0]).toMatchObject({ ok: true });
    expect(T("centroCusto").find((c) => c.id === "ccObra").ativo).toBe(true);
  });
});

// ═════════════════════════ Toda conta a pagar: centro e boleto ═════════════════════════
describe("conta a pagar (manual também): centro de custo e boleto", () => {
  const base = { fornecedorId: "fA", descricao: "Peças", valorTotal: 214.03, dataVencimento: "2026-11-10" };
  beforeEach(() => { T("fornecedor").push({ id: "fA", empresaId: "e1", nome: "Elétrica Central", documento: "33444555000166", ativo: true }); });

  it("criar com centro + boleto colado (com pontos): grava a linha e o código de barras; inválido = 400", async () => {
    const r = await contaApi("POST", { ...base, centroCustoId: "ccObra", boleto: "10492.00650 61000.100042 00997.263900 9 89810000021403" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ centroCustoId: "ccObra", linhaDigitavel: BOLETO_CAIXA.linha, codigoBarrasBoleto: BOLETO_CAIXA.barras });
    expect((await contaApi("POST", { ...base, boleto: trocar(BOLETO_CAIXA.linha, 12) })).json.erro).toMatch(/^Boleto: Dígito verificador não confere no campo 2/);
    expect((await contaApi("POST", { ...base, boleto: "1234" })).json.erro).toMatch(/^Boleto: Boleto incompleto/);
    expect(await contaApi("POST", { ...base, centroCustoId: "ccB" })).toMatchObject({ status: 400, json: { erro: "Centro de custo inválido(a)." } });
    expect((await contaApi("POST", { ...base, centroCustoId: "ccVelho" })).json.erro).toBe("Centro de custo inativo(a): escolha um(a) ativo(a).");
    expect(T("contaPagar")).toHaveLength(2); // a antiga + a válida
  });

  it("editar: sem boleto no corpo não mexe; vazio tira; centro inativo que já era o da conta pode ficar", async () => {
    const { json: c } = await contaApi("POST", { ...base, centroCustoId: "ccFrota", boleto: BOLETO_CAIXA.barras });
    T("centroCusto").find((x) => x.id === "ccFrota").ativo = false;
    expect((await contaApi("PUT", { descricao: "Peças (ajuste)", centroCustoId: "ccFrota" }, c.id)).status).toBe(200);
    expect(T("contaPagar").find((x) => x.id === c.id)).toMatchObject({ descricao: "Peças (ajuste)", centroCustoId: "ccFrota", linhaDigitavel: BOLETO_CAIXA.linha });
    expect((await contaApi("PUT", { boleto: "" }, c.id)).status).toBe(200);
    expect(T("contaPagar").find((x) => x.id === c.id)).toMatchObject({ linhaDigitavel: null, codigoBarrasBoleto: null });
    expect((await contaApi("PUT", { centroCustoId: "ccVelho" }, c.id)).status).toBe(400); // trocar por outro inativo, não
    expect((await contaApi("PUT", { centroCustoId: null }, c.id)).status).toBe(200);
    expect(T("contaPagar").find((x) => x.id === c.id).centroCustoId).toBeNull();
  });

  it("detalhe da conta: linha digitável formatada + código de barras para copiar, banco/valor/vencimento, centro e a NF de origem", async () => {
    const { json: c } = await contaApi("POST", { ...base, centroCustoId: "ccObra", formaPagamento: "BOLETO", boleto: BOLETO_CAIXA.linha });
    const h = await detalheConta(c.id);
    const t = sp(texto(h));
    expect(h).toContain(">10492.00650 61000.100042 00997.263900 9 89810000021403<");
    expect(h).toContain(`>${BOLETO_CAIXA.barras}<`);
    expect(h).toContain('data-copiar="Copiar linha"');
    expect(h).toContain('data-copiar="Copiar código"');
    expect(t).toContain("Caixa (104) · R$ 214,03 · vence 10/05/2022");
    expect(h).toContain('data-centro-custo="ccObra"');
    expect(t).toContain("Forma de pagamento Boleto");
    // sem boleto: diz onde colar; conta da NF: link para a nota
    const id = await nota1();
    await lancarApi(id, { itens: escolhas(id) });
    const daNf = await detalheConta(contasDa(id)[0].id);
    expect(daNf).toContain("data-sem-boleto");
    expect(daNf).toMatch(new RegExp(`<a (?=[^>]*data-nota-origem)(?=[^>]*href="/estoque/notas/${id}")`));
    logar(permissoesTotais(), "e2");
    await expect(detalheConta(c.id)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lista: link para o detalhe, centro de custo na linha, filtro por centro e por origem NF, marca de boleto", async () => {
    await contaApi("POST", { ...base, centroCustoId: "ccObra", boleto: BOLETO_CAIXA.linha });
    const id = await nota1();
    await lancarApi(id, { itens: escolhas(id), financeiro: { centroCustoId: "ccFrota" } });
    const h = await listaContas();
    expect(h).toContain('data-centro-custo="ccObra"');
    expect(h.match(/data-tem-boleto/g)).toHaveLength(1);
    expect(h).toMatch(/<a [^>]*data-detalhe-conta="[^"]+"[^>]*>|<a [^>]*href="\/financeiro\/contas-pagar\/[^"]+"[^>]*data-detalhe-conta/);
    expect(h).toMatch(/<a (?=[^>]*data-detalhe-conta)(?=[^>]*href="\/financeiro\/contas-pagar\/[^"]+")/);
    expect(h).toContain("<option value=\"ccObra\">Obra Shopping Norte</option>");
    expect(h).toContain("Obra encerrada (inativo)");
    const soFrota = await listaContas({ centro: "ccFrota" });
    expect(texto(soFrota).match(/NF 4521\/1 — parcela/g)).toHaveLength(3);
    expect(soFrota).not.toContain('data-centro-custo="ccObra"');
    expect(texto(await listaContas({ origem: "NF" }))).not.toContain("Peças");
    expect(texto(await listaContas({ origem: "MANUAL" }))).not.toContain("NF 4521/1");
  });
});

// ═════════════════════════ Atalho e telas ═════════════════════════
describe("atalho 'Lançar a partir de NF' e telas", () => {
  it("Contas a pagar tem o botão para a MESMA importação (só para quem pode importar); o voltar leva a Contas a pagar", async () => {
    const h = await listaContas();
    expect(h).toMatch(/<a (?=[^>]*data-lancar-nf)(?=[^>]*href="\/estoque\/notas\?de=contas-pagar")/);
    expect(texto(h)).toContain("Lançar a partir de NF");
    logar(so({ financeiro: { visualizar: true, fluxoCaixa: true }, estoque: { visualizar: true } }));
    expect(await listaContas()).not.toContain("data-lancar-nf");
    logar();
    const imp = await listaNotas("contas-pagar");
    expect(imp).toContain("data-upload-xml");
    expect(imp).toMatch(/<a (?=[^>]*data-voltar="contas-pagar")(?=[^>]*href="\/financeiro\/contas-pagar")/);
    expect(await listaNotas()).not.toContain('data-voltar="contas-pagar"'); // pelo Estoque: volta ao Estoque
    const id = await nota1();
    expect(await detalheNota(id, "contas-pagar")).toContain('data-voltar="contas-pagar"');
    expect(await listaNotas("contas-pagar")).toContain(`href="/estoque/notas/${id}?de=contas-pagar"`);
  });

  it("central: itens com o preço na linha, financeiro (categoria, centro, forma) e as 3 parcelas da NF", async () => {
    const id = await nota1();
    await rascunhoApi(id, { itens: escolhas(id) });
    const h = await detalheNota(id);
    expect(h).toContain("data-financeiro-nota");
    expect(h.match(/data-parcela="/g)).toHaveLength(3);
    expect(h).toContain("Como veio na NF (duplicatas).");
    expect(h).toMatch(/name="vencimento-3"[^>]*value="2027-01-13"|value="2027-01-13"[^>]*name="vencimento-3"/);
    expect(h).toMatch(/name="valor-1"[^>]*value="583,10"|value="583,10"[^>]*name="valor-1"/);
    expect(h).toContain('name="boleto-1"');
    expect(h.match(/data-preco-item="/g)).toHaveLength(3); // o tubo (criado no rascunho) também
    expect(h).toContain("Salvar rascunho");
    // (o campo de nome do produto novo é da interação: estoque-e21-ui.test.ts)
  });

  it("rascunho salvo volta para a tela: parcelas ajustadas, boleto, preço da linha", async () => {
    const id = await nota1();
    await rascunhoApi(id, {
      itens: escolhas(id, { 1: { preco: { modo: "margem", margem: 30 } } }),
      financeiro: { categoriaId: "catMat", centroCustoId: "ccObra", parcelas: [{ duplicata: null, vencimento: "2026-11-20", valor: 1749.3, boleto: BOLETO_CAIXA.linha }] },
    });
    const h = await detalheNota(id);
    expect(h.match(/data-parcela="/g)).toHaveLength(1);
    expect(h).toContain("Parcelas ajustadas aqui (a NF trazia outras).");
    expect(h).toContain(`value="${BOLETO_CAIXA.linha}"`);
    expect(h).toContain('data-situacao-preco="rascunho"');
    expect(sp(texto(h))).toContain("Novo preço — vai para o produto ao confirmar e lançar");
  });

  it("resultado: categoria, centro, forma e contas com boleto (link para o detalhe); preço definido na nota no lugar do aviso de custo", async () => {
    const id = await nota1();
    await lancarApi(id, {
      itens: escolhas(id, { 1: { preco: { modo: "preco", preco: 1200 } } }),
      financeiro: { categoriaId: "catMat", centroCustoId: "ccObra", formaPagamento: "BOLETO", parcelas: [{ duplicata: "001", vencimento: "2026-11-14", valor: 1749.3, boleto: BOLETO_CAIXA.linha }] },
    });
    const h = await detalheNota(id);
    expect(sp(texto(h))).toContain("Categoria: Materiais e peças Centro de custo: Obra Shopping Norte Forma: Boleto");
    expect(h).toContain("data-conta-boleto");
    expect(h).toMatch(new RegExp(`href="/financeiro/contas-pagar/${contasDa(id)[0].id}"`));
    expect(sp(texto(h))).toContain("Gás R410A 11,35 kg: preço de venda definido nesta nota — R$ 1.200,00 (preço fixo).");
    expect(h).not.toContain("data-avisos-custo");
  });
});
