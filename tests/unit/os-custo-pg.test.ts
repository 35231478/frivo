/**
 * Custo na OS — pelas rotas reais com o Prisma real num PostgreSQL real (schema descartável). Regra única do custo de
 * compra (lib/estoque/custo-acesso): Estoque › visualizar OU Orçamentos › ver custo; administrador sempre; TÉCNICO nunca.
 *  - sem login: 401; sem permissão de OS: 403; supervisor de OS SEM permissão de custo: 200 mas SEM a chave custoUnit
 *    (GET da OS, catálogo do item, respostas de POST/PUT/PATCH, props da página da OS);
 *  - com Estoque › visualizar ou Orçamentos › ver custo (ou admin): o custo vem;
 *  - técnico: o painel da OS é bloqueado (403) e o catálogo vem sem custo; o app não lê custo;
 *  - o salvar decide o custo no servidor: custo forjado é ignorado; produto que já estava mantém o custo gravado
 *    (mesmo com compra nova); produto novo pega o último custo; o supervisor salva sem apagar o custo;
 *  - "última compra" pela OS: 403 sem a regra;
 *  - relatório/PDF, link público, aceite e app do técnico nunca leem o custo (trava no código).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-custo-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_os_custo_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); },
  useRouter: () => ({}), usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
}));
vi.setConfig({ testTimeout: 60_000 });

const logar = (permissoes: Permissoes, role = "OPERADOR", id = "u1", tecnicoId: string | null = null) => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId: "e1", role, permissoes, tecnicoId } };
};
const OS_EDITAR = ["visualizar", "criar", "editar"] as const;
const ADMIN = () => logar(permissoesTotais());
const SUPERVISOR = () => logar(montarPermissoes({ ordens: [...OS_EDITAR] }));
const SUP_ESTOQUE = () => logar(montarPermissoes({ ordens: [...OS_EDITAR], estoque: ["visualizar"] }));
const SUP_VERCUSTO = () => logar(montarPermissoes({ ordens: [...OS_EDITAR], orcamentos: ["visualizar", "verCusto"] }));
const TECNICO = () => logar(permissoesTotais(), "TECNICO", "u1", "t1");

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/${rota}${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const texto = await res.text();
  let json: any = null; try { json = JSON.parse(texto); } catch { /* sem corpo */ }
  return { status: res.status, json, texto };
}

describe.skipIf(!URL_PG)("Custo na OS só com permissão (PostgreSQL real)", () => {
  let prisma: any;
  const ids: Record<string, string> = {};
  const catalogo = (qs: string) => chamar("ordens/[id]/orcamento/catalogo", "GET", undefined, { id: "os1" }, `?${qs}`);
  const custos = async (itemId: string) => (await prisma.osMaterial.findMany({ where: { osItemId: itemId }, orderBy: { ordem: "asc" }, select: { produtoId: true, custoUnit: true } }))
    .map((m: any) => [m.produtoId, m.custoUnit == null ? null : Number(m.custoUnit)]);
  const corpo = (materiais: any[]) => ({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais });
  const mat = (produtoId: string | null, descricao: string, comportamento: string, extra: Record<string, unknown> = {}) => ({
    produtoId, descricao, unidade: "un", comportamento, quantidade: 1, quantidadePadrao: 1, valorVendaUnit: 20, origem: "SOLTO", kitNome: null, ...extra,
  });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["ordens/[id]", "ordens/[id]/orcamento", "ordens/[id]/orcamento/[itemId]", "ordens/[id]/orcamento/catalogo", "compras/ultima-compra"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.configuracao.create({ data: { empresaId: "e1" } }).catch(() => {});
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" } });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    const pecas = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Peças", comportamento: "VENDA_A_PARTE" } });
    const matc = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Materiais", comportamento: "INCLUSO_NO_SERVICO" } });
    const p = (id: string, nome: string, cat: string | null) => prisma.produto.create({ data: { id, empresaId: "e1", nome, unidade: "un", categoriaProdutoId: cat, valorPadrao: 20, saldo: 10 } });
    await p("tubo", "Tubo de cobre", matc.id); await p("filtro", "Filtro secador", matc.id); await p("cap", "Capacitor 35uF", pecas.id); await p("fita", "Fita", matc.id);
    const compra = (produtoId: string, custo: number, data = "2026-02-01") => prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId, tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: custo, data: new Date(data) } });
    await compra("tubo", 12); await compra("filtro", 20); await compra("cap", 45); await compra("fita", 3);
    await prisma.servico.create({ data: { id: "sInst", empresaId: "e1", codigo: "INST", nome: "Instalação split", valorPadrao: 800, materiais: { create: [{ produtoId: "tubo", quantidade: 3, ordem: 0 }, { produtoId: "filtro", quantidade: 1, ordem: 1 }, { produtoId: "cap", quantidade: 1, ordem: 2 }] } } });
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", numero: "OS-1", clienteId: "c1", criadoPorId: "u1", status: "ABERTA", origem: "MANUAL", descricao: "OS avulsa" } });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("catálogo do item: 401 sem login, 403 sem OS › editar; supervisor sem a chave custoUnit; com Estoque/ver custo/admin, com custo; técnico sem", async () => {
    sessao.atual = null;
    expect((await catalogo("servicoId=sInst")).status).toBe(401);
    logar(montarPermissoes({ ordens: ["visualizar"] }));
    expect((await catalogo("servicoId=sInst")).status).toBe(403);
    SUPERVISOR();
    const sup = await catalogo("servicoId=sInst");
    expect(sup.status).toBe(200);
    expect(sup.json.materiais.map((m: any) => [m.produtoId, m.valorVendaUnit])).toEqual([["tubo", 20], ["filtro", 20], ["cap", 20]]);
    expect(sup.texto).not.toMatch(/custoUnit/);
    const avulso = await catalogo("produtoId=fita");
    expect(avulso.json.material).toMatchObject({ produtoId: "fita" });
    expect(avulso.texto).not.toMatch(/custoUnit/);
    for (const quem of [ADMIN, SUP_ESTOQUE, SUP_VERCUSTO]) {
      quem();
      expect((await catalogo("servicoId=sInst")).json.materiais.map((m: any) => m.custoUnit)).toEqual([12, 20, 45]);
    }
    TECNICO();
    const tec = await catalogo("servicoId=sInst");
    expect(tec.status).toBe(200);
    expect(tec.texto).not.toMatch(/custoUnit/);
  });

  it("POST do item: o custo forjado é ignorado (grava o último custo); a resposta do supervisor não traz custo", async () => {
    SUPERVISOR();
    const r = await chamar("ordens/[id]/orcamento", "POST", corpo([
      mat("tubo", "Tubo", "INCLUSO_NO_SERVICO", { custoUnit: 999 }), mat("filtro", "Filtro", "INCLUSO_NO_SERVICO"),
      mat("cap", "Capacitor", "VENDA_A_PARTE", { custoUnit: 0.01 }), mat(null, "Linha à mão", "INCLUSO_NO_SERVICO", { custoUnit: 50 }),
    ]), { id: "os1" });
    expect(r.status).toBe(201);
    expect(r.texto).not.toMatch(/custoUnit/);
    expect(r.json.pecas).toHaveLength(1);
    ids.item = r.json.id;
    expect(await custos(ids.item)).toEqual([["tubo", 12], ["filtro", 20], ["cap", 45], [null, null]]);
    ADMIN();
    const a = await chamar("ordens/[id]/orcamento", "POST", corpo([mat("tubo", "Tubo", "INCLUSO_NO_SERVICO", { custoUnit: 1 })]), { id: "os1" });
    expect(a.json.materiais.map((m: any) => Number(m.custoUnit))).toEqual([12]); // admin recebe, mas o forjado não vale
    await chamar("ordens/[id]/orcamento/[itemId]", "DELETE", undefined, { id: "os1", itemId: a.json.id });
  });

  it("PUT do item: produto que já estava mantém o custo (mesmo com compra nova); produto novo pega o último; supervisor não apaga custo", async () => {
    await prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId: "tubo", tipo: "ENTRADA", origem: "COMPRA", quantidade: 5, saldoApos: 15, custoUnitario: 30, data: new Date("2026-03-01") } });
    SUPERVISOR();
    // como a tela do supervisor manda: sem custoUnit (o servidor nem mandou)
    const r = await chamar("ordens/[id]/orcamento/[itemId]", "PUT", corpo([
      mat("tubo", "Tubo", "INCLUSO_NO_SERVICO", { quantidade: 4 }), mat("filtro", "Filtro", "INCLUSO_NO_SERVICO"), mat("cap", "Capacitor", "VENDA_A_PARTE"), mat("fita", "Fita (nova)", "INCLUSO_NO_SERVICO"),
    ]), { id: "os1", itemId: ids.item });
    expect(r.status).toBe(200);
    expect(r.texto).not.toMatch(/custoUnit/);
    expect(await custos(ids.item)).toEqual([["tubo", 12], ["filtro", 20], ["cap", 45], ["fita", 3]]);
    // Admin manda custo forjado em todos: nada muda
    ADMIN();
    const a = await chamar("ordens/[id]/orcamento/[itemId]", "PUT", corpo([
      mat("tubo", "Tubo", "INCLUSO_NO_SERVICO", { custoUnit: 0 }), mat("filtro", "Filtro", "INCLUSO_NO_SERVICO", { custoUnit: 0 }),
      mat("cap", "Capacitor", "VENDA_A_PARTE", { custoUnit: 0 }), mat("fita", "Fita", "INCLUSO_NO_SERVICO", { custoUnit: 0 }),
    ]), { id: "os1", itemId: ids.item });
    expect(a.status).toBe(200);
    expect(a.json.materiais.map((m: any) => Number(m.custoUnit))).toEqual([12, 20, 45, 3]);
    expect(await custos(ids.item)).toEqual([["tubo", 12], ["filtro", 20], ["cap", 45], ["fita", 3]]);
  });

  it("PUT: o custo 'gravado' é só o DESTE item — produto que está em outro item com outro custo pega o último custo de compra", async () => {
    SUPERVISOR();
    const d = await chamar("ordens/[id]/orcamento", "POST", corpo([mat("tubo", "Tubo", "INCLUSO_NO_SERVICO")]), { id: "os1" });
    expect(d.status).toBe(201);
    // O filtro do OUTRO item ganha um custo "especial": não pode vazar para este item
    await prisma.osMaterial.updateMany({ where: { osItemId: ids.item, produtoId: "filtro" }, data: { custoUnit: 1 } });
    const r = await chamar("ordens/[id]/orcamento/[itemId]", "PUT", corpo([mat("tubo", "Tubo", "INCLUSO_NO_SERVICO"), mat("filtro", "Filtro", "INCLUSO_NO_SERVICO")]), { id: "os1", itemId: d.json.id });
    expect(r.status).toBe(200);
    expect(await custos(d.json.id)).toEqual([["tubo", 30], ["filtro", 20]]);
    await prisma.osMaterial.updateMany({ where: { osItemId: ids.item, produtoId: "filtro" }, data: { custoUnit: 20 } });
    await chamar("ordens/[id]/orcamento/[itemId]", "DELETE", undefined, { id: "os1", itemId: d.json.id });
  });

  it("PATCH da linha: supervisor recebe o item sem custo; admin com custo; o custo gravado fica", async () => {
    SUPERVISOR();
    const r = await chamar("ordens/[id]/orcamento/[itemId]", "PATCH", { descricao: "Instalação split (sala 2)" }, { id: "os1", itemId: ids.item });
    expect(r.status).toBe(200);
    expect(r.json.materiais).toHaveLength(4);
    expect(r.texto).not.toMatch(/custoUnit/);
    ADMIN();
    const a = await chamar("ordens/[id]/orcamento/[itemId]", "PATCH", { quantidade: 1 }, { id: "os1", itemId: ids.item });
    expect(a.json.materiais.map((m: any) => Number(m.custoUnit))).toEqual([12, 20, 45, 3]);
  });

  it("GET da OS: supervisor sem a chave custoUnit; com permissão de custo, com; técnico bloqueado (403); sem login 401", async () => {
    SUPERVISOR();
    const s = await chamar("ordens/[id]", "GET", undefined, { id: "os1" });
    expect(s.status).toBe(200);
    expect(s.json.itensOrcamento.flatMap((i: any) => i.materiais)).toHaveLength(4);
    expect(s.texto).not.toMatch(/custoUnit/);
    for (const quem of [ADMIN, SUP_ESTOQUE, SUP_VERCUSTO]) {
      quem();
      const c = await chamar("ordens/[id]", "GET", undefined, { id: "os1" });
      expect(c.json.itensOrcamento.find((i: any) => i.id === ids.item).materiais.map((m: any) => Number(m.custoUnit))).toEqual([12, 20, 45, 3]);
    }
    TECNICO();
    const t = await chamar("ordens/[id]", "GET", undefined, { id: "os1" });
    expect(t.status).toBe(403);
    expect(t.texto).not.toMatch(/custoUnit/);
    sessao.atual = null;
    expect((await chamar("ordens/[id]", "GET", undefined, { id: "os1" })).status).toBe(401);
  });

  it("página da OS: o supervisor não recebe custoUnit nas props (o dado não chega ao navegador) e verCusto=false; admin recebe", async () => {
    const { default: Pagina } = await import("@/app/(dashboard)/ordens/[id]/page");
    const props = async () => ((await Pagina({ params: Promise.resolve({ id: "os1" }), searchParams: Promise.resolve({}) } as any)) as any).props;
    SUPERVISOR();
    const s = await props();
    expect(s.verCusto).toBe(false);
    expect(s.os.itensOrcamento.flatMap((i: any) => i.materiais)).toHaveLength(4);
    expect(JSON.stringify(s.os.itensOrcamento)).not.toMatch(/custoUnit/);
    ADMIN();
    const a = await props();
    expect(a.verCusto).toBe(true);
    expect(a.os.itensOrcamento.find((i: any) => i.id === ids.item).materiais.map((m: any) => Number(m.custoUnit))).toEqual([12, 20, 45, 3]);
  });

  it("última compra pela OS: 403 sem a regra; com Estoque › visualizar, 200", async () => {
    const ultima = () => chamar("compras/ultima-compra", "GET", undefined, {}, "?produtoIds=tubo");
    SUPERVISOR();
    const n = await ultima();
    expect(n.status).toBe(403);
    expect(n.texto).not.toMatch(/30|12/);
    SUP_ESTOQUE();
    expect((await ultima()).json.tubo).toMatchObject({ valorUnitario: 30 });
  });

  it("relatório/PDF, link público, aceite e app do técnico nunca leem o custo (trava no código)", () => {
    const pastas = ["app/(publico)/relatorio", "app/(impressao)", "app/api/publico", "app/api/tecnico", "app/(tecnico)", "lib/relatorio-os", "lib/tecnico", "app/api/ordens/[id]/aceite", "app/api/ordens/[id]/relatorios"];
    const arquivos = ["lib/relatorio-server.ts", "lib/relatorio-atividade-link.ts", "lib/relatorio-mensal-contrato.ts", "lib/tecnico/o-que-levar-server.ts"];
    const ler = (p: string): string[] => {
      const abs = path.join(RAIZ, p);
      if (!fs.existsSync(abs)) return [];
      if (fs.statSync(abs).isFile()) return [fs.readFileSync(abs, "utf8")];
      return fs.readdirSync(abs).flatMap((f) => ler(path.join(p, f)));
    };
    const textos = [...pastas, ...arquivos].flatMap(ler);
    expect(textos.length).toBeGreaterThan(20);
    for (const t of textos) expect(t).not.toMatch(/custoUnit|custo_unit|custoUnitario|ultimosCustos/);
  });
});
