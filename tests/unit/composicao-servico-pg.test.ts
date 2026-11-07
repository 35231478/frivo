/**
 * Estoque E3.2 — as rotas reais com o Prisma real num PostgreSQL real (schema descartável via `prisma db push`),
 * para o que o banco em memória não prova:
 *  - o `include` de verdade: itens do kit (com o produto e a categoria) na lista; a composição do serviço com o kit
 *    "aberto" no registro único; o `_count` e o `orderBy` por contagem;
 *  - gravar/regravar os filhos (`create` / `deleteMany + create`) e o kit VIVO pela relação real;
 *  - o custo de referência (último custo de compra) na lista do kit e na rota de custos (só a empresa da sessão);
 *  - a trava de nome único com `mode: "insensitive"`; o impacto só da empresa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/composicao-servico-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { expandirComposicao } from "@/lib/estoque/composicao";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_composicao_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await carregar();
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const api = (entidade: string) => (metodo: string, corpo?: unknown, id?: string, qs = "") => id
  ? chamar(() => import("@/app/api/cadastros/[entidade]/[id]/route"), metodo, { entidade, id }, corpo)
  : chamar(() => import("@/app/api/cadastros/[entidade]/route"), metodo, { entidade }, corpo, `http://localhost/api/cadastros/${entidade}${qs}`);
const kits = api("kits-material");
const servicos = api("servicos");
const impacto = (entidade: string, id: string) => chamar(() => import("@/app/api/cadastros/[entidade]/[id]/impacto/route"), "GET", { entidade, id });
const custos = (ids: string) => chamar(() => import("@/app/api/estoque/custos/route"), "GET", {}, undefined, `http://localhost/api/estoque/custos?ids=${ids}`);

describe.skipIf(!URL_PG)("Kits + composição do serviço (PostgreSQL real)", () => {
  let prisma: any;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([import("@/app/api/cadastros/[entidade]/route"), import("@/app/api/cadastros/[entidade]/[id]/route"), import("@/app/api/cadastros/[entidade]/[id]/impacto/route"), import("@/app/api/estoque/custos/route")]);
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    const pecas = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Peças", comportamento: "VENDA_A_PARTE" } });
    const mat = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Materiais", comportamento: "INCLUSO_NO_SERVICO" } });
    const p = async (nome: string, unidade: string, cat: string | null, empresaId = "e1") => (await prisma.produto.create({ data: { empresaId, nome, unidade, categoriaProdutoId: cat } })).id;
    ids.gas = await p("Gás R410A", "kg", mat.id); ids.cap = await p("Capacitor", "un", pecas.id); ids.sup = await p("Suporte", "un", null); ids.outro = await p("Da outra", "un", null, "e2");
    const mov = (produtoId: string, custo: number | null, data: string) =>
      prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId, tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: custo, data: new Date(data) } });
    await mov(ids.gas, 40, "2026-01-10"); await mov(ids.gas, 50, "2026-02-10"); await mov(ids.cap, 30, "2026-02-01"); await mov(ids.sup, null, "2026-02-01");
    logar();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("kit: cria com os itens (include real: produto + categoria), lista com custo de referência e ordem por itens; nome único insensitive; itens regravados ao editar", async () => {
    const r = await kits("POST", { nome: "Kit instalação", itens: [{ produtoId: ids.gas, quantidade: "0,5" }, { produtoId: ids.sup, quantidade: 2 }] });
    expect(r.status).toBe(201);
    ids.kit = r.json.id;
    expect(r.json.itens.map((i: any) => [i.produtoId, Number(i.quantidade), i.produto.unidade, i.produto.categoriaProduto?.comportamento ?? null]))
      .toEqual([[ids.gas, 0.5, "kg", "INCLUSO_NO_SERVICO"], [ids.sup, 2, "un", null]]);
    expect((await kits("POST", { nome: "KIT INSTALAÇÃO", itens: [] })).status).toBe(409);
    expect((await kits("POST", { nome: "Kit vazio", itens: [] })).status).toBe(201);
    const lista = await kits("GET", undefined, undefined, "?pagina=1&por=20&ordem=itens&dir=desc");
    expect(lista.json.itens.map((k: any) => k.nome)).toEqual(["Kit instalação", "Kit vazio"]);
    const k = lista.json.itens[0];
    expect(k.custoReferencia).toEqual({ total: 25, semCusto: [ids.sup] }); // 0,5 kg × 50 (a última compra); suporte sem custo
    expect(k._count).toEqual({ servicoMateriais: 0 });
    expect(lista.json.itens[1].custoReferencia).toEqual({ total: 0, semCusto: [] });
    // Editar os itens regrava (deleteMany + create); só o nome não mexe nos itens
    expect((await kits("PATCH", { nome: "Kit instalação split" }, ids.kit)).status).toBe(200);
    expect(await prisma.kitMaterialItem.count({ where: { kitId: ids.kit } })).toBe(2);
    expect((await kits("PATCH", { itens: [{ produtoId: ids.gas, quantidade: 1 }, { produtoId: ids.cap, quantidade: 1 }, { produtoId: ids.sup, quantidade: 4 }] }, ids.kit)).status).toBe(200);
    const itens = await prisma.kitMaterialItem.findMany({ where: { kitId: ids.kit }, orderBy: { ordem: "asc" } });
    expect(itens.map((i: any) => [i.produtoId, Number(i.quantidade), i.ordem])).toEqual([[ids.gas, 1, 0], [ids.cap, 1, 1], [ids.sup, 4, 2]]);
    expect((await kits("PATCH", { itens: [{ produtoId: ids.outro, quantidade: 1 }] }, ids.kit)).json).toEqual({ erro: "Produto inválido(a)." });
    expect(await prisma.kitMaterialItem.count({ where: { kitId: ids.kit } })).toBe(3);
  });

  it("serviço: composição gravada e lida com o kit aberto; kit vivo pela relação real; edição parcial; _count na lista; impacto e custos só da empresa", async () => {
    const r = await servicos("POST", { nome: "Instalação split", materiais: [{ produtoId: ids.cap, quantidade: 1, comportamento: "INCLUSO_NO_SERVICO" }, { kitId: ids.kit, quantidade: 2 }] });
    expect(r.status).toBe(201);
    ids.servico = r.json.id;
    const g = await servicos("GET", undefined, ids.servico);
    expect(g.json.materiais.map((m: any) => [m.produtoId, m.kitId, Number(m.quantidade), m.comportamento, m.ordem]))
      .toEqual([[ids.cap, null, 1, "INCLUSO_NO_SERVICO", 0], [null, ids.kit, 2, null, 1]]);
    expect(g.json.materiais[1].kit.itens.map((i: any) => i.produto.nome)).toEqual(["Gás R410A", "Capacitor", "Suporte"]);
    expect(expandirComposicao(g.json.materiais).map((m) => [m.nome, m.quantidade, m.comportamento, m.origem.tipo])).toEqual([
      ["Capacitor", 1, "INCLUSO_NO_SERVICO", "solto"], ["Gás R410A", 2, "INCLUSO_NO_SERVICO", "kit"], ["Capacitor", 2, "VENDA_A_PARTE", "kit"], ["Suporte", 8, "INCLUSO_NO_SERVICO", "kit"],
    ]);
    // Kit vivo: muda o kit, o serviço lê os itens novos (nada regravado em servico_materiais)
    await kits("PATCH", { itens: [{ produtoId: ids.gas, quantidade: 3 }] }, ids.kit);
    const g2 = await servicos("GET", undefined, ids.servico);
    expect(expandirComposicao(g2.json.materiais).map((m) => [m.nome, m.quantidade])).toEqual([["Capacitor", 1], ["Gás R410A", 6]]);
    expect(await prisma.servicoMaterial.count({ where: { servicoId: ids.servico } })).toBe(2);
    // Lista: _count; ordenar por materiais
    const semComposicao = await servicos("POST", { nome: "Limpeza" });
    expect((await servicos("GET", undefined, semComposicao.json.id)).json.materiais).toEqual([]);
    const lista = await servicos("GET", undefined, undefined, "?pagina=1&por=20&ordem=materiais&dir=desc");
    expect(lista.json.itens.map((s: any) => [s.nome, s._count.materiais])).toEqual([["Instalação split", 2], ["Limpeza", 0]]);
    // Parcial: renomear não mexe; `materiais` regrava
    expect((await servicos("PATCH", { nome: "Instalação split 12k" }, ids.servico)).status).toBe(200);
    expect(await prisma.servicoMaterial.count({ where: { servicoId: ids.servico } })).toBe(2);
    const e = await servicos("PATCH", { materiais: JSON.stringify([{ produtoId: ids.gas, quantidade: "1,5" }]) }, ids.servico);
    expect(e.json.materiais.map((m: any) => [m.produtoId, Number(m.quantidade)])).toEqual([[ids.gas, 1.5]]);
    expect(await prisma.servicoMaterial.count()).toBe(1);
    // Impacto do kit e do produto (só a empresa da sessão)
    await servicos("PATCH", { materiais: [{ kitId: ids.kit, quantidade: 1 }, { produtoId: ids.gas, quantidade: 1 }] }, ids.servico);
    expect((await impacto("kits-material", ids.kit)).json.usos).toEqual([{ rotulo: "1 serviço", total: 1 }]);
    expect((await impacto("produtos", ids.gas)).json.usos).toEqual(expect.arrayContaining([{ rotulo: "1 kit de material", total: 1 }, { rotulo: "1 serviço (materiais padrão)", total: 1 }]));
    logar(permissoesTotais(), "e2");
    expect((await impacto("kits-material", ids.kit)).status).toBe(404);
    expect((await servicos("POST", { nome: "Roubo", materiais: [{ kitId: ids.kit, quantidade: 1 }] })).json).toEqual({ erro: "Kit de material inválido(a)." });
    expect((await custos(`${ids.gas},${ids.outro}`)).json).toEqual({ custos: {} }); // produtos da e1 não vazam para a e2
    logar();
    expect((await custos(`${ids.gas},${ids.cap},${ids.sup},${ids.outro}`)).json).toEqual({ custos: { [ids.gas]: 50, [ids.cap]: 30 } });
    // Apagar o kit (FK CASCADE) some com a linha da composição; o produto solto fica
    await prisma.kitMaterial.delete({ where: { id: ids.kit } });
    expect((await servicos("GET", undefined, ids.servico)).json.materiais.map((m: any) => m.produtoId)).toEqual([ids.gas]);
  });
});
