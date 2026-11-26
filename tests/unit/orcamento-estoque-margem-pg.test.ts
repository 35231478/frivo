/**
 * Orçamento, leva B — estoque e margem com as rotas reais e o Prisma real num PostgreSQL real (schema descartável):
 *  - situação dos produtos: disponível = saldo (já líquido das reservas, a mesma regra do Estoque); produto sem
 *    controle = null; só a empresa da sessão; Estoque desligado = o campo nem vem (200, nunca 403);
 *  - SEGURANÇA: sem "Orçamentos › Ver custo e margem" o custo NÃO sai do servidor — nem na rota de situação, nem no
 *    GET do orçamento, nem nos materiais-padrão, nem na página do Editar; o documento do cliente (link e PDF) nunca
 *    lê o custo;
 *  - o salvar decide o custo no servidor: custo forjado é ignorado, o gravado fica, material novo pega o último
 *    custo de compra, e quem não vê custo salva sem apagar o custo gravado.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamento-estoque-margem-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_margem_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// A página do Editar usa notFound/redirect do Next: aqui viram exceções legíveis
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); },
  useRouter: () => ({}), usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
}));
vi.setConfig({ testTimeout: 60_000 });

const logar = (permissoes: Permissoes, empresaId = "e1", id = "u1", role = "OPERADOR") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role, permissoes, tecnicoId: null } };
};
const ADMIN = () => logar(permissoesTotais());
const VENDEDOR = () => logar(montarPermissoes({ orcamentos: ["visualizar", "criar", "editar"] }));

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/${rota}${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const texto = await res.text();
  let json: any = null; try { json = JSON.parse(texto); } catch { /* sem corpo */ }
  return { status: res.status, json, texto };
}
const situacao = (ids: string) => chamar("orcamentos/situacao-produtos", "GET", undefined, {}, `?ids=${ids}`);

describe.skipIf(!URL_PG)("Orçamento: estoque e margem (PostgreSQL real)", () => {
  let prisma: any;
  let esquecerModulos: (e?: string) => void;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ esquecerModulos } = await import("@/lib/modulos/servidor"));
    await Promise.all(["orcamentos", "orcamentos/[id]", "orcamentos/materiais-padrao", "orcamentos/situacao-produtos", "estoque/custos", "compras/ultima-compra", "estoque/[produtoId]/preco"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" }, { id: "c9", empresaId: "e2", nome: "Da outra", cpfCnpj: "33444555000100" }] });
    const p = (id: string, nome: string, unidade: string, saldo: number, extra: Record<string, unknown> = {}, empresaId = "e1") =>
      prisma.produto.create({ data: { id, empresaId, nome, unidade, valorPadrao: 50, saldo, ...extra } });
    await p("filtro", "Filtro G4", "un", 4);
    await p("cap", "Capacitor 35uF", "un", -1);          // reservado além do que há (a reserva já saiu do saldo)
    await p("gas", "Gás R410A", "kg", 12.5);
    await p("mao", "Fita isolante", "un", 0, { controlaEstoque: false });
    await p("tubo", "Tubo de cobre", "m", 30);
    await p("outro", "Da outra empresa", "un", 99, {}, "e2");
    const compra = (produtoId: string, custo: number, data: string, empresaId = "e1") =>
      prisma.movimentacaoEstoque.create({ data: { empresaId, produtoId, tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: custo, data: new Date(data) } });
    await compra("filtro", 30, "2026-01-10"); await compra("filtro", 38.5, "2026-02-10"); // último custo = 38,5
    await compra("cap", 21, "2026-02-01"); await compra("gas", 92, "2026-02-01"); await compra("tubo", 12, "2026-02-01");
    await compra("outro", 1, "2026-02-01", "e2");
    await prisma.servico.create({ data: { id: "sInst", empresaId: "e1", codigo: "INST", nome: "Instalação", valorPadrao: 800, materiais: { create: [{ produtoId: "tubo", quantidade: 3, ordem: 0 }, { produtoId: "filtro", quantidade: 1, ordem: 1 }] } } });
    ADMIN();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("situação: disponível = saldo (líquido das reservas), sem controle = null, último custo de compra; só a empresa da sessão", async () => {
    ADMIN();
    const r = await situacao("filtro,cap,gas,mao,outro,nao-existe");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      estoque: true, verCusto: true,
      produtos: {
        filtro: { unidade: "un", disponivel: 4, custo: 38.5 },
        cap: { unidade: "un", disponivel: -1, custo: 21 },
        gas: { unidade: "kg", disponivel: 12.5, custo: 92 },
        mao: { unidade: "un", disponivel: null, custo: null },
      },
    });
    expect((await situacao("")).json).toEqual({ estoque: true, verCusto: true, produtos: {} });
    // Da outra empresa: os produtos de e1 não aparecem
    logar(permissoesTotais(), "e2", "u2");
    expect(Object.keys((await situacao("filtro,outro")).json.produtos)).toEqual(["outro"]);
  });

  it("situação SEM a permissão: o custo NÃO vem (a chave some), o disponível vem; só visualizar = 403", async () => {
    VENDEDOR();
    const r = await situacao("filtro,cap,mao");
    expect(r.status).toBe(200);
    expect(r.texto).not.toMatch(/"custo"/);
    expect(r.json).toEqual({ estoque: true, verCusto: false, produtos: { filtro: { unidade: "un", disponivel: 4 }, cap: { unidade: "un", disponivel: -1 }, mao: { unidade: "un", disponivel: null } } });
    logar(montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await situacao("filtro")).status).toBe(403);
    // Perfil com a permissão nova ligada (não administrador): vê o custo
    logar(montarPermissoes({ orcamentos: ["visualizar", "editar", "verCusto"] }));
    expect((await situacao("filtro")).json.produtos.filtro).toEqual({ unidade: "un", disponivel: 4, custo: 38.5 });
    // role ADMIN vê mesmo com o JSON de permissões vazio
    logar(montarPermissoes({ orcamentos: ["criar"] }), "e1", "u1", "ADMIN");
    expect((await situacao("filtro")).json.verCusto).toBe(true);
  });

  it("Estoque desligado: 200 (nunca 403), estoque=false e nenhum disponível; o custo segue para quem pode", async () => {
    await prisma.empresaModulo.create({ data: { empresaId: "e1", modulo: "estoque", ativo: false } });
    esquecerModulos();
    try {
      ADMIN();
      const r = await situacao("filtro,mao");
      expect(r.status).toBe(200);
      expect(r.texto).not.toMatch(/"disponivel"/);
      expect(r.json).toEqual({ estoque: false, verCusto: true, produtos: { filtro: { unidade: "un", custo: 38.5 }, mao: { unidade: "un", custo: null } } });
      VENDEDOR();
      expect((await situacao("filtro")).json).toEqual({ estoque: false, verCusto: false, produtos: { filtro: { unidade: "un" } } });
    } finally {
      await prisma.empresaModulo.deleteMany({ where: { empresaId: "e1", modulo: "estoque" } });
      esquecerModulos();
    }
  });

  it("materiais-padrão: com a permissão traz custoUnit; sem ela, a chave nem vem (serviço e avulso)", async () => {
    ADMIN();
    const a = await chamar("orcamentos/materiais-padrao", "GET", undefined, {}, "?servicoId=sInst&clienteId=c1");
    expect(a.json.materiais.map((m: any) => [m.produtoId, m.custoUnit])).toEqual([["tubo", 12], ["filtro", 38.5]]);
    VENDEDOR();
    const v = await chamar("orcamentos/materiais-padrao", "GET", undefined, {}, "?servicoId=sInst&clienteId=c1");
    expect(v.status).toBe(200);
    expect(v.json.materiais).toHaveLength(2);
    expect(v.texto).not.toMatch(/custoUnit/);
    const av = await chamar("orcamentos/materiais-padrao", "GET", undefined, {}, "?produtoId=gas&clienteId=c1");
    expect(av.json.material).toMatchObject({ produtoId: "gas" });
    expect(av.texto).not.toMatch(/custoUnit/);
  });

  const corpo = (materiais: any[], extra: Record<string, unknown> = {}) => ({
    clienteId: "c1",
    servicos: [{ catalogoId: "sInst", descricao: "Instalação", quantidade: 1, valorUnitario: 800, materiais }],
    produtos: [{ catalogoId: "gas", descricao: "Gás R410A", quantidade: 3, valorUnitario: 120 }],
    ...extra,
  });
  const mat = (produtoId: string, descricao: string, quantidade: number, custoUnit?: number | null, id?: string) => ({
    ...(id && { id }), produtoId, descricao, unidade: "un", comportamento: "INCLUSO_NO_SERVICO", quantidade, quantidadePadrao: quantidade,
    valorVendaUnit: 20, origem: "SOLTO", kitNome: null, ...(custoUnit !== undefined && { custoUnit }),
  });
  const custosGravados = async (orcamentoId: string) =>
    (await prisma.orcamentoMaterial.findMany({ where: { orcamentoId }, orderBy: { ordem: "asc" }, select: { id: true, produtoId: true, custoUnit: true } }))
      .map((m: any) => ({ id: m.id, produtoId: m.produtoId, custo: m.custoUnit == null ? null : Number(m.custoUnit) }));

  it("salvar (POST): custo forjado pelo navegador é ignorado — grava o último custo de compra; linha à mão = sem custo", async () => {
    ADMIN();
    const r = await chamar("orcamentos", "POST", corpo([mat("tubo", "Tubo", 3, 999), mat("filtro", "Filtro", 1, 0.01), { ...mat("filtro", "Fita à mão", 1, 50), produtoId: null }]));
    expect(r.status).toBe(201);
    expect(r.texto).not.toMatch(/custoUnit/); // a resposta não traz itens
    ids.orc = r.json.id;
    expect((await custosGravados(ids.orc)).map((m: any) => [m.produtoId, m.custo])).toEqual([["tubo", 12], ["filtro", 38.5], [null, null]]);
  });

  it("GET do orçamento: admin recebe o custo; vendedor NÃO recebe a chave custoUnit", async () => {
    ADMIN();
    const a = await chamar("orcamentos/[id]", "GET", undefined, { id: ids.orc });
    expect(a.json.servicos[0].materiais.map((m: any) => m.custoUnit == null ? null : Number(m.custoUnit))).toEqual([12, 38.5, null]);
    VENDEDOR();
    const v = await chamar("orcamentos/[id]", "GET", undefined, { id: ids.orc });
    expect(v.status).toBe(200);
    expect(v.json.servicos[0].materiais).toHaveLength(3);
    expect(v.texto).not.toMatch(/custoUnit|custo_unit/);
    expect(v.texto).not.toMatch(/"12"|"38\.5"/);
  });

  it("salvar (PUT): o custo gravado fica mesmo com compra nova; material novo pega o último; o vendedor salva sem apagar o custo", async () => {
    const gravados = await custosGravados(ids.orc);
    // Compra nova do filtro: o custo do orçamento é o copiado na hora de orçar, não muda
    await prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId: "filtro", tipo: "ENTRADA", origem: "COMPRA", quantidade: 5, saldoApos: 9, custoUnitario: 45, data: new Date("2026-03-01") } });
    VENDEDOR();
    // Como a tela do vendedor manda: sem custoUnit (o servidor nem o entregou)
    const r = await chamar("orcamentos/[id]", "PUT", corpo([
      mat("tubo", "Tubo", 4, undefined, gravados[0].id),
      mat("filtro", "Filtro", 1, undefined, gravados[1].id),
      mat("gas", "Gás (novo)", 1, undefined),
    ]), { id: ids.orc });
    expect(r.status).toBe(200);
    expect(r.texto).not.toMatch(/custoUnit/);
    expect((await custosGravados(ids.orc)).map((m: any) => [m.produtoId, m.custo])).toEqual([["tubo", 12], ["filtro", 38.5], ["gas", 92]]);

    // Admin manda custo forjado num material gravado: ignorado (fica o gravado)
    ADMIN();
    const agora = await custosGravados(ids.orc);
    await chamar("orcamentos/[id]", "PUT", corpo(agora.map((m: any) => mat(m.produtoId, "x", 1, 0, m.id))), { id: ids.orc });
    expect((await custosGravados(ids.orc)).map((m: any) => m.custo)).toEqual([12, 38.5, 92]);
  });

  it("salvar: id de material de OUTRO orçamento não leva o custo dele (vale o último custo de compra)", async () => {
    ADMIN();
    const outro = await chamar("orcamentos", "POST", corpo([mat("filtro", "Filtro", 1)]));
    const [doOutro] = await custosGravados(outro.json.id);
    expect(doOutro.custo).toBe(45); // já pega a compra mais nova
    // Força um custo "especial" no material do outro orçamento e tenta reaproveitá-lo pelo id
    await prisma.orcamentoMaterial.update({ where: { id: doOutro.id }, data: { custoUnit: 1 } });
    const r = await chamar("orcamentos/[id]", "PUT", corpo([mat("filtro", "Filtro", 1, 1, doOutro.id)]), { id: ids.orc });
    expect(r.status).toBe(200);
    const [m] = await custosGravados(ids.orc);
    expect(m.custo).toBe(45);
  });

  it("página do Editar: o vendedor não recebe custoUnit nas props (o dado não chega ao navegador); o admin recebe", async () => {
    const { default: Pagina } = await import("@/app/(dashboard)/orcamentos/[id]/editar/page");
    const props = async () => ((await Pagina({ params: Promise.resolve({ id: ids.orc }) })) as any).props;
    ADMIN();
    const a = await props();
    expect(a.inicial.servicos[0].materiais.map((m: any) => m.custoUnit)).toEqual([45]);
    VENDEDOR();
    const v = await props();
    expect(v.inicial.servicos[0].materiais).toHaveLength(1);
    expect(JSON.stringify(v)).not.toMatch(/custoUnit/);
    expect(JSON.stringify(v.inicial)).not.toMatch(/45/);
  });

  it("documento do cliente (link público e PDF): a consulta nem lê materiais nem custo", async () => {
    const { INCLUDE_DOCUMENTO_ORCAMENTO } = await import("@/lib/orcamentos/documento-server");
    expect(JSON.stringify(INCLUDE_DOCUMENTO_ORCAMENTO)).not.toMatch(/materiais|custo/i);
    const doc = await prisma.orcamento.findUnique({ where: { id: ids.orc }, include: INCLUDE_DOCUMENTO_ORCAMENTO });
    expect(JSON.stringify(doc)).not.toMatch(/custoUnit|custo_unit|"45"/);
  });

  /* ───── Outras portas do custo de compra (pedido do Zé no #241): a regra única é lib/estoque/custo-acesso ───── */

  it("GET /api/estoque/custos: só com Estoque › visualizar ou Orçamentos › ver custo; sem login = 401; sem permissão = 403 sem o dado", async () => {
    const custos = () => chamar("estoque/custos", "GET", undefined, {}, "?ids=gas,tubo,outro");
    sessao.atual = null;
    expect((await custos()).status).toBe(401);
    VENDEDOR(); // orçamentos (visualizar/criar/editar), sem custo
    const negado = await custos();
    expect(negado.status).toBe(403);
    expect(negado.texto).not.toMatch(/92|12/);
    logar(montarPermissoes({ configuracoes: ["gerenciar"] })); // quem edita kit/serviço, mas sem permissão de custo
    expect((await custos()).status).toBe(403);
    logar(montarPermissoes({ estoque: ["visualizar"] }));
    expect((await custos()).json).toEqual({ custos: { gas: 92, tubo: 12 } }); // "outro" é de outra empresa
    logar(montarPermissoes({ orcamentos: ["visualizar", "verCusto"] }));
    expect((await custos()).json).toEqual({ custos: { gas: 92, tubo: 12 } });
    logar(montarPermissoes({}), "e1", "u1", "ADMIN");
    expect((await custos()).status).toBe(200);
  });

  it("GET /api/compras/ultima-compra: pelo orçamento só com permissão de custo; Compras e OS como antes", async () => {
    const ultima = () => chamar("compras/ultima-compra", "GET", undefined, {}, "?produtoIds=gas");
    VENDEDOR();
    const negado = await ultima();
    expect(negado.status).toBe(403);
    expect(negado.texto).not.toMatch(/92/);
    logar(montarPermissoes({ orcamentos: ["visualizar", "editar", "verCusto"] }));
    expect((await ultima()).json.gas).toMatchObject({ valorUnitario: 92 });
    logar(montarPermissoes({ compras: ["visualizar"] }));
    expect((await ultima()).status).toBe(200);
    logar(montarPermissoes({ ordens: ["visualizar", "editar"] })); // OS: fica para a leva do custo na OS
    expect((await ultima()).status).toBe(200);
    logar(montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await ultima()).status).toBe(403);
  });

  it("PUT /api/estoque/[id]/preco: salva o preço; custo, margem e markup só voltam para quem pode ver custo", async () => {
    logar(montarPermissoes({ configuracoes: ["gerenciar"] }));
    const sem = await chamar("estoque/[produtoId]/preco", "PUT", { modo: "preco", preco: 150 }, { produtoId: "gas" });
    expect(sem.status).toBe(200);
    expect(sem.json).toEqual({ preco: 150, margemVenda: null });
    expect(sem.texto).not.toMatch(/custo|margem"|markup/);
    expect(Number((await prisma.produto.findUnique({ where: { id: "gas" } })).valorPadrao)).toBe(150);
    logar(montarPermissoes({ configuracoes: ["gerenciar"], estoque: ["visualizar"] }));
    const com = await chamar("estoque/[produtoId]/preco", "PUT", { modo: "preco", preco: 184 }, { produtoId: "gas" });
    expect(com.json).toMatchObject({ preco: 184, custo: 92, margem: 50 });
  });
});
