/**
 * Orçamento, leva C — "Solicitar compra dos faltantes" com as rotas reais e o Prisma real num PostgreSQL real:
 *  - GET: 401/403/200; o que falta por produto (produtos + materiais; sem controle de estoque fica fora); sem custo;
 *  - POST cria UM pedido SOLICITADO ligado ao orçamento (e à OS gerada), observação de origem, só os faltantes na
 *    quantidade que falta, sem valor estimado; evento "Pedido criado";
 *  - IDEMPOTENTE: 2º clique não cria; dois cliques ao mesmo tempo criam um só; falta nova entra no pedido ainda
 *    "Solicitado"; com o pedido já em cotação, nasce outro só com a diferença; cancelado não conta;
 *  - permissão (Compras › gerenciar ou Orçamentos › editar), módulos (Compras E Estoque; desligado = GET 200 sem nada),
 *    multiempresa (orçamento de outra empresa = 404) e orçamento cancelado (400).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/compra-faltantes-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_compra_faltantes_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 60_000 });

const logar = (permissoes: Permissoes, empresaId = "e1", id = "u1", role = "OPERADOR") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role, permissoes } };
};
const ADMIN = () => logar(permissoesTotais());
const VENDEDOR = () => logar(montarPermissoes({ orcamentos: ["visualizar", "criar", "editar"] }));

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/${rota}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const texto = await res.text();
  let json: any = null; try { json = JSON.parse(texto); } catch { /* sem corpo */ }
  return { status: res.status, json, texto };
}

describe.skipIf(!URL_PG)("Compra dos faltantes do orçamento (PostgreSQL real)", () => {
  let prisma: any;
  let esquecerModulos: (e?: string) => void;
  let orc = "";
  const get = () => chamar("orcamentos/[id]/compra-faltantes", "GET", undefined, { id: orc });
  const post = () => chamar("orcamentos/[id]/compra-faltantes", "POST", undefined, { id: orc });
  const pedidos = () => prisma.pedidoCompraInterno.findMany({ where: { orcamentoId: orc }, orderBy: { criadoEm: "asc" }, include: { itens: { orderBy: { descricao: "asc" } }, eventos: true } });
  const itensDe = (p: any) => p.itens.map((i: any) => [i.produtoId, Number(i.quantidade), i.valorEstimado]);
  async function desligar(modulo: string, fn: () => Promise<void>) {
    await prisma.empresaModulo.create({ data: { empresaId: "e1", modulo, ativo: false } });
    esquecerModulos();
    try { await fn(); } finally { await prisma.empresaModulo.deleteMany({ where: { empresaId: "e1", modulo } }); esquecerModulos(); }
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ esquecerModulos } = await import("@/lib/modulos/servidor"));
    await Promise.all(["orcamentos", "orcamentos/[id]/compra-faltantes"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" } });
    const p = (id: string, nome: string, saldo: number, extra: Record<string, unknown> = {}) => prisma.produto.create({ data: { id, empresaId: "e1", nome, unidade: "un", valorPadrao: 50, saldo, ...extra } });
    await p("cap", "Capacitor 35uF", -1); await p("gas", "Gás R410A", 12); await p("tubo", "Tubo de cobre", 2); await p("fita", "Fita isolante", 0, { controlaEstoque: false });
    await prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId: "cap", tipo: "ENTRADA", origem: "COMPRA", quantidade: 1, saldoApos: 1, custoUnitario: 21 } });
    await prisma.servico.create({ data: { id: "sInst", empresaId: "e1", codigo: "INST", nome: "Instalação", valorPadrao: 800 } });
    ADMIN();
    const mat = (produtoId: string, descricao: string, quantidade: number) => ({ produtoId, descricao, unidade: "un", comportamento: "INCLUSO_NO_SERVICO", quantidade, quantidadePadrao: quantidade, valorVendaUnit: 0, origem: "SOLTO", kitNome: null });
    const r = await chamar("orcamentos", "POST", {
      clienteId: "c1",
      servicos: [{ catalogoId: "sInst", descricao: "Instalação", quantidade: 1, valorUnitario: 800, materiais: [mat("tubo", "Tubo de cobre", 3), mat("fita", "Fita isolante", 2), mat("cap", "Capacitor 35uF", 1)] }],
      produtos: [{ catalogoId: "cap", descricao: "Capacitor 35uF", quantidade: 1, valorUnitario: 30 }, { catalogoId: "gas", descricao: "Gás R410A", quantidade: 3, valorUnitario: 120 }],
    });
    expect(r.status).toBe(201);
    orc = r.json.id;
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("GET: 401 sem login, 403 sem ver orçamento; lista só o que falta (produtos + materiais, sem os sem controle) e nenhum custo", async () => {
    sessao.atual = null;
    expect((await get()).status).toBe(401);
    logar(montarPermissoes({ ordens: ["visualizar"] }));
    expect((await get()).status).toBe(403);
    VENDEDOR();
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.json.disponivel).toBe(true);
    expect(r.json.podeSolicitar).toBe(true);
    // capacitor: 1 (produto) + 1 (material) = 2, disponível −1 → faltam 3; tubo: 3 − 2 → 1; gás cobre; fita sem controle
    expect(r.json.faltantes.map((f: any) => [f.produtoId, f.necessario, f.disponivel, f.falta, f.aSolicitar])).toEqual([["cap", 2, -1, 3, 3], ["tubo", 3, 2, 1, 1]]);
    expect(r.texto).not.toMatch(/custo|valorEstimado|21/i);
    logar(montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await get()).json.podeSolicitar).toBe(false);
  });

  it("pedido aberto de OUTRA origem (avulso / outro orçamento) com o mesmo produto não abate a falta deste orçamento", async () => {
    const outro = await prisma.pedidoCompraInterno.create({ data: { empresaId: "e1", numero: "PCI-AV", solicitanteId: "u1", status: "SOLICITADO", motivo: "Reposição", itens: { create: [{ produtoId: "cap", descricao: "Capacitor", quantidade: 99, unidade: "un" }] } } });
    VENDEDOR();
    const r = await get();
    expect(r.json.faltantes.find((f: any) => f.produtoId === "cap")).toMatchObject({ falta: 3, solicitado: 0, aSolicitar: 3, pedidos: [] });
    await prisma.pedidoCompraInterno.delete({ where: { id: outro.id } });
  });

  it("POST: cria UM pedido SOLICITADO, ligado ao orçamento, observação de origem, só os faltantes, sem valor estimado", async () => {
    VENDEDOR();
    const r = await post();
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ ok: true, acao: "criado", itens: 2 });
    const [pc] = await pedidos();
    expect(pc).toMatchObject({ status: "SOLICITADO", orcamentoId: orc, ordemServicoId: null, solicitanteId: "u1", empresaId: "e1", fornecedorId: null });
    expect(pc.observacao).toMatch(/^Gerado do orçamento .+: itens sem estoque suficiente\.$/);
    expect(itensDe(pc)).toEqual([["cap", 3, null], ["tubo", 1, null]]);
    expect(pc.eventos.map((e: any) => e.tipo)).toEqual(["CRIADO"]);
    // a tela marca: compra solicitada, com o número do pedido
    const g = await get();
    expect(g.json.faltantes.map((f: any) => [f.produtoId, f.solicitado, f.aSolicitar, f.pedidos.map((p: any) => p.numero)])).toEqual([["cap", 3, 0, [pc.numero]], ["tubo", 1, 0, [pc.numero]]]);
  });

  it("idempotente: 2º clique não cria nada; dois cliques AO MESMO TEMPO continuam um pedido só", async () => {
    VENDEDOR();
    const r = await post();
    expect(r.status).toBe(200);
    expect(r.json.acao).toBe("nada");
    const [a, b] = await Promise.all([post(), post()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await pedidos()).toHaveLength(1);
  });

  it("falta nova com o pedido ainda 'Solicitado': entra NELE (soma no item existente / item novo), sem pedido novo", async () => {
    await prisma.orcamentoProduto.updateMany({ where: { orcamentoId: orc, produtoId: "cap", materialId: null }, data: { quantidade: 3 } }); // cap: 3 + 1 = 4 → falta 5
    await prisma.produto.update({ where: { id: "gas" }, data: { saldo: 1 } }); // gás: 3 − 1 → falta 2
    VENDEDOR();
    const r = await post();
    expect(r.json).toMatchObject({ acao: "acrescentado", itens: 2 });
    const lista = await pedidos();
    expect(lista).toHaveLength(1);
    expect(itensDe(lista[0])).toEqual([["cap", 5, null], ["gas", 2, null], ["tubo", 1, null]]);
    expect(lista[0].eventos.map((e: any) => e.tipo).sort()).toEqual(["CRIADO", "EDITADO"]);
  });

  it("pedido já em cotação: nasce OUTRO só com a diferença; cancelado não conta", async () => {
    const [pc] = await pedidos();
    await prisma.pedidoCompraInterno.update({ where: { id: pc.id }, data: { status: "COTANDO" } });
    await prisma.produto.update({ where: { id: "tubo" }, data: { saldo: 0 } }); // tubo: 3 − 0 → falta 3; já pedido 1 → pedir 2
    VENDEDOR();
    const r = await post();
    expect(r.status).toBe(201);
    let lista = await pedidos();
    expect(lista).toHaveLength(2);
    expect(itensDe(lista[1])).toEqual([["tubo", 2, null]]);
    // cancela os dois: tudo volta a faltar pedir
    await prisma.pedidoCompraInterno.updateMany({ where: { orcamentoId: orc }, data: { status: "CANCELADO" } });
    await post();
    lista = await pedidos();
    expect(lista).toHaveLength(3);
    expect(itensDe(lista[2])).toEqual([["cap", 5, null], ["gas", 2, null], ["tubo", 3, null]]);
  });

  it("OS gerada do orçamento: o pedido nasce ligado também à OS", async () => {
    await prisma.pedidoCompraInterno.updateMany({ where: { orcamentoId: orc }, data: { status: "CANCELADO" } });
    await prisma.ordemServico.create({ data: { id: "osG", empresaId: "e1", numero: "OS-1", clienteId: "c1", criadoPorId: "u1", status: "ABERTA", origem: "MANUAL", descricao: "Gerada", orcamentoOrigemId: orc } });
    ADMIN();
    await post();
    const lista = await pedidos();
    expect(lista.at(-1)).toMatchObject({ orcamentoId: orc, ordemServicoId: "osG", status: "SOLICITADO" });
  });

  it("corrida: cinco cliques ao mesmo tempo, com o que criar, criam UM pedido só (a trava por orçamento)", async () => {
    await prisma.pedidoCompraInterno.updateMany({ where: { orcamentoId: orc }, data: { status: "CANCELADO" } });
    const antes = (await pedidos()).length;
    ADMIN();
    const r = await Promise.all([post(), post(), post(), post(), post()]);
    expect(r.filter((x) => x.status === 201)).toHaveLength(1);
    expect(r.filter((x) => x.status === 200).every((x) => x.json.acao === "nada")).toBe(true);
    expect(await pedidos()).toHaveLength(antes + 1);
  });

  it("permissão: só ver orçamento = 403; Compras › gerenciar (sem editar orçamento) pode; sem login 401", async () => {
    await prisma.pedidoCompraInterno.updateMany({ where: { orcamentoId: orc }, data: { status: "CANCELADO" } });
    logar(montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await post()).status).toBe(403);
    sessao.atual = null;
    expect((await post()).status).toBe(401);
    logar(montarPermissoes({ compras: ["visualizar", "gerenciar"] }));
    expect((await post()).status).toBe(201);
  });

  it("módulos: sem Estoque ou sem Compras, GET 200 com disponivel=false (a tela some) e o POST não cria", async () => {
    await prisma.pedidoCompraInterno.updateMany({ where: { orcamentoId: orc }, data: { status: "CANCELADO" } });
    const antes = (await pedidos()).length;
    for (const modulo of ["estoque", "compras"]) {
      await desligar(modulo, async () => {
        ADMIN();
        const g = await get();
        expect(g.status).toBe(200);
        expect(g.json).toEqual({ disponivel: false });
        const p = await post();
        expect(p.status).toBe(403);
        expect(p.json.modulo).toBe(modulo);
      });
    }
    expect(await pedidos()).toHaveLength(antes);
  });

  it("multiempresa: orçamento de outra empresa = 404 (GET e POST) e nada é criado", async () => {
    const antes = await prisma.pedidoCompraInterno.count();
    logar(permissoesTotais(), "e2", "u2");
    expect((await get()).status).toBe(404);
    expect((await post()).status).toBe(404);
    expect(await prisma.pedidoCompraInterno.count()).toBe(antes);
  });

  it("orçamento cancelado: POST 400 e o botão não aparece (podeSolicitar=false)", async () => {
    await prisma.pedidoCompraInterno.updateMany({ where: { orcamentoId: orc }, data: { status: "CANCELADO" } });
    await prisma.orcamento.update({ where: { id: orc }, data: { status: "CANCELADO" } });
    ADMIN();
    expect((await post()).status).toBe(400);
    expect((await get()).json.podeSolicitar).toBe(false);
  });
});
