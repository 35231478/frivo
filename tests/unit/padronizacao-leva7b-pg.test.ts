/**
 * Leva 7B — Comprar: as ROTAS e a SUGESTÃO num PostgreSQL real (schema descartável).
 *
 * A tela esconde o que a pessoa não pode fazer; aqui se prova o outro lado — com a requisição na
 * mão, o servidor RECUSA e o banco não muda:
 *  - importar NF e lançar exigem Estoque › gerenciar; lançar exige TAMBÉM Financeiro › fluxo de caixa
 *    (porque gera conta a pagar); vincular a nota a um pedido exige Compras › gerenciar; a sugestão
 *    do pedido avulso exige Compras › gerenciar;
 *  - o vínculo nota↔estoque↔conta a pagar: lançar grava a entrada E as contas na mesma transação,
 *    as duas apontando para a nota; lançar de novo é 409 e nada dobra; nota lançada não se apaga.
 *  - a sugestão lê o estoque de verdade: produto no mínimo entra, com o último fornecedor e preço só
 *    com 2 compras em 6 meses — com histórico fino, entra sem preço.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva7b-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva7b_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const XML = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4521-frigelar.xml"), "utf8");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// e-mail/sino do solicitante do pedido não têm nada a ver com o que se prova aqui
vi.mock("@/lib/compras/conciliacao-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/compras/conciliacao-server")>()),
  avisarSolicitanteNf: vi.fn(async () => {}),
}));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana Souza", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const req = (corpo: unknown, metodo = "POST") =>
  new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

async function importar(xml: string) {
  const mod = await import("@/app/api/compras/notas/route");
  const res: Response = await mod.POST(req({ xml }));
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function lancar(notaId: string, corpo: unknown = {}) {
  const mod = await import("@/app/api/compras/notas/[id]/lancar/route");
  const res: Response = await mod.POST(req(corpo), { params: Promise.resolve({ id: notaId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function salvarRascunho(notaId: string, corpo: unknown) {
  const mod = await import("@/app/api/compras/notas/[id]/conciliacao/route");
  const res: Response = await mod.PUT(req(corpo, "PUT"), { params: Promise.resolve({ id: notaId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function vincularPedido(notaId: string, pedidoId: string) {
  const mod = await import("@/app/api/compras/notas/[id]/vinculos/route");
  const res: Response = await mod.POST(req({ pedidoId }), { params: Promise.resolve({ id: notaId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function pedirSugestoes() {
  const mod = await import("@/app/api/compras/sugestoes/route");
  const res: Response = await mod.GET();
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Leva 7B — Comprar (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
  }, 240_000);

  afterAll(async () => {
    if (!URL_PG) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.movimentacaoEstoque.deleteMany({});
    await prisma.contaPagar.deleteMany({});
    await prisma.notaCompraItem.deleteMany({});
    await prisma.notaCompra.deleteMany({});
    await prisma.produto.deleteMany({});
    await prisma.fornecedor.deleteMany({});
    await prisma.produto.createMany({ data: [
      { id: "pGas", empresaId: "e1", nome: "Gás R410A", unidade: "un", controlaEstoque: true, saldo: 1, estoqueMinimo: 4 },
      { id: "pCap", empresaId: "e1", nome: "Capacitor 35uF", unidade: "pc", controlaEstoque: true, saldo: 0, estoqueMinimo: 10 },
      { id: "pTubo", empresaId: "e1", nome: "Tubo de cobre", unidade: "m", controlaEstoque: true, saldo: 50, estoqueMinimo: 10 },
      { id: "pE2", empresaId: "e2", nome: "Produto da outra", unidade: "un", controlaEstoque: true, saldo: 0, estoqueMinimo: 5 },
    ] });
    como();
  });

  const contagens = async () => ({
    notas: await prisma.notaCompra.count(),
    movs: await prisma.movimentacaoEstoque.count(),
    contas: await prisma.contaPagar.count(),
  });

  /* ───────── prioridade 1: o servidor recusa ───────── */

  it("importar a NF sem Estoque › gerenciar é 403, e nenhuma nota entra", async () => {
    como(montarPermissoes({ estoque: ["visualizar"], compras: ["visualizar", "gerenciar"] }));
    const r = await importar(XML);
    expect(r.status).toBe(403);
    expect(r.json.erro).toBe("Sem permissão para esta ação");
    expect(await prisma.notaCompra.count()).toBe(0);
  });

  it("lançar sem Estoque › gerenciar é 403, e nada vai para o estoque nem para o financeiro", async () => {
    const { json } = await importar(XML);
    const notaId = json.nota.id;
    const antes = await contagens();

    como(montarPermissoes({ estoque: ["visualizar"], financeiro: ["visualizar", "fluxoCaixa"] }));
    const r = await lancar(notaId);
    expect([r.status, r.json.erro]).toEqual([403, "Sem permissão para esta ação"]);
    expect(await contagens()).toEqual(antes);
    expect((await prisma.notaCompra.findUnique({ where: { id: notaId } })).status).toBe("IMPORTADA");
  });

  it("lançar sem Financeiro › fluxo de caixa é 403 e DIZ por quê (lançar gera conta a pagar)", async () => {
    const { json } = await importar(XML);
    const antes = await contagens();

    como(montarPermissoes({ estoque: ["visualizar", "gerenciar"], financeiro: ["visualizar"] }));
    const r = await lancar(json.nota.id);
    expect(r.status).toBe(403);
    expect(r.json.erro).toContain("Financeiro › fluxo de caixa");
    expect(await contagens()).toEqual(antes);
  });

  it("vincular a nota a um pedido sem Compras › gerenciar é 403", async () => {
    const { json } = await importar(XML);
    como(montarPermissoes({ estoque: ["visualizar", "gerenciar"], compras: ["visualizar"] }));
    const r = await vincularPedido(json.nota.id, "qualquer");
    expect([r.status, r.json.erro]).toEqual([403, "Sem permissão para esta ação"]);
  });

  it("a sugestão do pedido avulso sem Compras › gerenciar é 403 (e sem sessão, 401)", async () => {
    como(montarPermissoes({ compras: ["visualizar"], estoque: ["visualizar", "gerenciar"] }));
    expect((await pedirSugestoes()).status).toBe(403);
    sessao.atual = null;
    const semSessao = await pedirSugestoes();
    expect([semSessao.status, semSessao.json.erro]).toEqual([401, "Não autorizado"]);
  });

  it("nada atravessa de outra empresa: a nota da e1 não é vista pela e2", async () => {
    const { json } = await importar(XML);
    como(permissoesTotais(), "e2");
    const r = await lancar(json.nota.id);
    expect(r.status).toBe(404);
    expect((await prisma.notaCompra.findUnique({ where: { id: json.nota.id } })).status).toBe("IMPORTADA");
  });

  /* ───────── o vínculo nota ↔ estoque ↔ conta a pagar ───────── */

  it("lançar grava a entrada no estoque E as contas a pagar, as duas apontando para a nota", async () => {
    const { json } = await importar(XML);
    const notaId = json.nota.id;
    const itens = await prisma.notaCompraItem.findMany({ where: { notaId }, orderBy: { numeroItem: "asc" } });
    const r = await salvarRascunho(notaId, {
      itens: [
        { itemId: itens[0].id, produtoId: "pGas" },
        { itemId: itens[1].id, produtoId: "pCap" },
        { itemId: itens[2].id, novo: { nome: "Tubo de cobre 1/4", unidade: "M" } },
      ],
    });
    expect([r.status, r.json.faltam]).toEqual([200, 0]);

    const lancou = await lancar(notaId);
    expect(lancou.status).toBe(201);

    const nota = await prisma.notaCompra.findUnique({ where: { id: notaId }, include: { contasPagar: true } });
    expect(nota.status).toBe("LANCADA");
    expect(nota.lancadaEm).toBeInstanceOf(Date);

    // estoque: uma entrada por item, de origem COMPRA, com a nota como referência
    const movs = await prisma.movimentacaoEstoque.findMany({ where: { empresaId: "e1" } });
    expect(movs).toHaveLength(3);
    expect(movs.every((m: any) => m.tipo === "ENTRADA" && m.origem === "COMPRA" && m.refId === notaId)).toBe(true);
    // o saldo subiu pelo razão (2 un de gás na nota, sobre o saldo 1)
    expect(Number((await prisma.produto.findUnique({ where: { id: "pGas" } })).saldo)).toBe(3);

    // financeiro: as contas da nota, com a mesma nota como referência
    expect(nota.contasPagar.length).toBeGreaterThan(0);
    expect(nota.contasPagar.every((c: any) => c.notaCompraId === notaId)).toBe(true);
    const totalContas = nota.contasPagar.reduce((t: number, c: any) => t + Number(c.valorTotal), 0);
    expect(totalContas).toBeCloseTo(Number(nota.valorTotal), 2);
  });

  it("lançar duas vezes é 409: o estoque e as contas não dobram", async () => {
    const { json } = await importar(XML);
    const notaId = json.nota.id;
    const itens = await prisma.notaCompraItem.findMany({ where: { notaId }, orderBy: { numeroItem: "asc" } });
    await salvarRascunho(notaId, { itens: itens.map((i: any, k: number) => ({ itemId: i.id, produtoId: ["pGas", "pCap", "pTubo"][k] })) });
    expect((await lancar(notaId)).status).toBe(201);
    const depoisDoPrimeiro = await contagens();

    const segundo = await lancar(notaId);
    expect(segundo.status).toBe(409);
    expect(segundo.json.erro).toContain("já foi lançada");
    expect(await contagens()).toEqual(depoisDoPrimeiro);
  });

  it("nota lançada não muda mais de vínculo (corrigir é estorno/ajuste, como no razão da 7A)", async () => {
    const { json } = await importar(XML);
    const notaId = json.nota.id;
    const itens = await prisma.notaCompraItem.findMany({ where: { notaId }, orderBy: { numeroItem: "asc" } });
    await salvarRascunho(notaId, { itens: itens.map((i: any, k: number) => ({ itemId: i.id, produtoId: ["pGas", "pCap", "pTubo"][k] })) });
    await lancar(notaId);

    const r = await salvarRascunho(notaId, { itens: [{ itemId: itens[0].id, produtoId: "pTubo" }] });
    expect(r.status).toBe(409);
    expect(r.json.erro).toContain("não mudam mais");
    // e a rota de nota não tem como apagar o que foi lançado
    const mod: Record<string, unknown> = await import("@/app/api/compras/notas/[id]/lancar/route");
    for (const verbo of ["DELETE", "PUT", "PATCH"]) expect(mod[verbo], verbo).toBeUndefined();
  });

  /* ───────── a sugestão lendo o estoque de verdade ───────── */

  const nota = async (opts: { id: string; fornecedor: string; dias: number; itens: [string, number][] }) => {
    const f = await prisma.fornecedor.upsert({
      where: { id: `forn-${opts.fornecedor}` },
      create: { id: `forn-${opts.fornecedor}`, empresaId: "e1", nome: opts.fornecedor, documento: `doc-${opts.fornecedor}` },
      update: {},
    });
    const data = new Date(Date.now() - opts.dias * 86_400_000);
    return prisma.notaCompra.create({
      data: {
        id: opts.id, empresaId: "e1", fornecedorId: f.id, chaveAcesso: opts.id.padEnd(44, "0"),
        numero: opts.id, serie: "1", dataEmissao: data, valorTotal: 100, xml: "<x/>",
        emitenteNome: opts.fornecedor, emitenteCnpj: `doc-${opts.fornecedor}`, status: "LANCADA",
        itens: {
          create: opts.itens.map(([produtoId, valor], k) => ({
            numeroItem: k + 1, codigoFornecedor: `c${k}`, descricaoFornecedor: `item ${k}`,
            unidade: "un", quantidade: 1, valorUnitario: valor, valorTotal: valor, produtoId,
          })),
        },
      },
    });
  };

  it("produto no mínimo com 2 compras na janela: traz o ÚLTIMO fornecedor e preço", async () => {
    await nota({ id: "nf1", fornecedor: "Frigelar", dias: 120, itens: [["pGas", 900]] });
    await nota({ id: "nf2", fornecedor: "Refrimais", dias: 10, itens: [["pGas", 980]] });
    const { sugestoesDoEstoque } = await import("@/lib/compras/sugestao-compra-server");
    const r = await sugestoesDoEstoque("e1");
    const gas = r.find((s) => s.produtoId === "pGas")!;
    expect([gas.fornecedor, gas.valorUnitario, gas.vezes]).toEqual(["Refrimais", 980, 2]);
    expect(gas.faltam).toBe(3); // mínimo 4, saldo 1
  });

  it("histórico fino (uma compra só): o produto entra, sem palpite de preço", async () => {
    await nota({ id: "nf1", fornecedor: "Frigelar", dias: 30, itens: [["pCap", 18.45]] });
    const { sugestoesDoEstoque } = await import("@/lib/compras/sugestao-compra-server");
    const cap = (await sugestoesDoEstoque("e1")).find((s) => s.produtoId === "pCap")!;
    expect([cap.fornecedor, cap.valorUnitario, cap.vezes]).toEqual([null, null, 1]);
    expect(cap.faltam).toBe(10);
  });

  it("compra fora da janela de 6 meses não conta como histórico", async () => {
    await nota({ id: "nf1", fornecedor: "Frigelar", dias: 300, itens: [["pGas", 900]] });
    await nota({ id: "nf2", fornecedor: "Frigelar", dias: 250, itens: [["pGas", 910]] });
    const { sugestoesDoEstoque } = await import("@/lib/compras/sugestao-compra-server");
    const gas = (await sugestoesDoEstoque("e1")).find((s) => s.produtoId === "pGas")!;
    expect([gas.valorUnitario, gas.vezes]).toEqual([null, 0]);
  });

  // entrada de compra lançada à mão (sem NF): também é histórico, e também respeita a janela
  const entradaCompra = async (produtoId: string, custo: number, dias: number) => {
    const data = new Date(Date.now() - dias * 86_400_000);
    return prisma.movimentacaoEstoque.create({
      data: {
        empresaId: "e1", produtoId, tipo: "ENTRADA", origem: "COMPRA", quantidade: 1, saldoApos: 1,
        custoUnitario: custo, data, usuarioId: "uA",
      },
    });
  };

  it("entrada de compra sem NF também conta como histórico (2 na janela trazem o último custo)", async () => {
    await entradaCompra("pGas", 870, 90);
    await entradaCompra("pGas", 915, 7);
    const { sugestoesDoEstoque } = await import("@/lib/compras/sugestao-compra-server");
    const gas = (await sugestoesDoEstoque("e1")).find((s) => s.produtoId === "pGas")!;
    expect([gas.vezes, gas.valorUnitario]).toEqual([2, 915]);
    expect(gas.fornecedor).toBeNull(); // sem NF, não há de quem
  });

  it("entrada de compra fora da janela de 6 meses não conta (nem a mais recente)", async () => {
    await entradaCompra("pGas", 870, 400);
    await entradaCompra("pGas", 915, 220);
    const { sugestoesDoEstoque } = await import("@/lib/compras/sugestao-compra-server");
    const gas = (await sugestoesDoEstoque("e1")).find((s) => s.produtoId === "pGas")!;
    expect([gas.vezes, gas.valorUnitario]).toEqual([0, null]);
  });

  it("entrada que não é compra (ajuste, devolução) nunca vira histórico de preço", async () => {
    await entradaCompra("pGas", 870, 30);
    await prisma.movimentacaoEstoque.create({
      data: { empresaId: "e1", produtoId: "pGas", tipo: "ENTRADA", origem: "AJUSTE", quantidade: 1, saldoApos: 2, custoUnitario: 999, data: new Date(), usuarioId: "uA" },
    });
    const { sugestoesDoEstoque } = await import("@/lib/compras/sugestao-compra-server");
    const gas = (await sugestoesDoEstoque("e1")).find((s) => s.produtoId === "pGas")!;
    expect([gas.vezes, gas.valorUnitario]).toEqual([1, null]);
  });

  it("produto com saldo acima do mínimo não é sugerido; o de outra empresa, nunca", async () => {
    const { sugestoesDoEstoque } = await import("@/lib/compras/sugestao-compra-server");
    const ids = (await sugestoesDoEstoque("e1")).map((s) => s.produtoId);
    expect(ids).toContain("pGas");
    expect(ids).toContain("pCap");
    expect(ids).not.toContain("pTubo");
    expect(ids).not.toContain("pE2");
  });

  it("produto que não controla estoque, ou inativo, fica fora da sugestão", async () => {
    await prisma.produto.update({ where: { id: "pGas" }, data: { ativo: false } });
    await prisma.produto.update({ where: { id: "pCap" }, data: { controlaEstoque: false } });
    const { sugestoesDoEstoque } = await import("@/lib/compras/sugestao-compra-server");
    expect(await sugestoesDoEstoque("e1")).toEqual([]);
  });

  it("a entrada da própria nota lançada vira histórico de compra (a nota é o documento)", async () => {
    const { json } = await importar(XML);
    const notaId = json.nota.id;
    const itens = await prisma.notaCompraItem.findMany({ where: { notaId }, orderBy: { numeroItem: "asc" } });
    await salvarRascunho(notaId, { itens: itens.map((i: any, k: number) => ({ itemId: i.id, produtoId: ["pGas", "pCap", "pTubo"][k] })) });
    await lancar(notaId);
    // a entrada (refId = nota) e o item da nota são a MESMA compra: uma vez, não duas
    const { sugestoesDoEstoque } = await import("@/lib/compras/sugestao-compra-server");
    const gas = (await sugestoesDoEstoque("e1")).find((s) => s.produtoId === "pGas")!;
    expect(gas.vezes).toBe(1);
    expect(gas.valorUnitario).toBeNull();
  });

  it("a rota devolve a sugestão para quem pode criar pedido avulso", async () => {
    await nota({ id: "nf1", fornecedor: "Frigelar", dias: 100, itens: [["pGas", 900]] });
    await nota({ id: "nf2", fornecedor: "Frigelar", dias: 5, itens: [["pGas", 950]] });
    como(permissoesTotais());
    const r = await pedirSugestoes();
    expect(r.status).toBe(200);
    const gas = r.json.itens.find((s: any) => s.produtoId === "pGas");
    expect([gas.nome, gas.fornecedor, gas.valorUnitario]).toEqual(["Gás R410A", "Frigelar", 950]);
  });
});
