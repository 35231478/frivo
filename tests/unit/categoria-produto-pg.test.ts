/**
 * Estoque E3.1 — as rotas reais do cadastro padronizado com o Prisma real num PostgreSQL real (schema
 * descartável via `prisma db push`), para o que o banco em memória não prova:
 *  - a categoria vem junto na resposta do produto (criar, editar e lista: o `include` de verdade);
 *  - o seed por empresa com `createMany` e a trava de nome único com `mode: "insensitive"`;
 *  - o filtro por categoria e o "sem categoria" (NULL) no SQL gerado; o impacto só da empresa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/categoria-produto-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_categoria_produto_pg_${process.pid}`;
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
const categorias = api("categorias-produto");
const produtos = api("produtos");
const impacto = (id: string) => chamar(() => import("@/app/api/cadastros/[entidade]/[id]/impacto/route"), "GET", { entidade: "categorias-produto", id });

describe.skipIf(!URL_PG)("Categoria de produto (PostgreSQL real)", () => {
  let prisma: any;
  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([import("@/app/api/cadastros/[entidade]/route"), import("@/app/api/cadastros/[entidade]/[id]/route"), import("@/app/api/cadastros/[entidade]/[id]/impacto/route")]);
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    logar();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("seed por empresa na primeira listagem (2× não duplica); nome único sem diferença de maiúsculas; a outra empresa tem as suas", async () => {
    expect((await categorias("GET")).json.map((c: any) => c.nome)).toEqual(["Materiais de instalação/consumo", "Peças de reposição"]);
    await categorias("GET");
    expect(await prisma.categoriaProduto.count({ where: { empresaId: "e1" } })).toBe(2);
    expect((await categorias("POST", { nome: "peças DE reposição", comportamento: "VENDA_A_PARTE" })).status).toBe(409);
    logar(permissoesTotais(), "e2");
    expect((await categorias("GET")).json).toHaveLength(2);
    expect(await prisma.categoriaProduto.count()).toBe(4);
    logar();
  });

  it("produto: a categoria vem junto ao criar, editar e listar (include real); filtro por id e 'sem' (NULL); impacto só da empresa", async () => {
    const pecas = await prisma.categoriaProduto.findFirst({ where: { empresaId: "e1", comportamento: "VENDA_A_PARTE" } });
    const materiais = await prisma.categoriaProduto.findFirst({ where: { empresaId: "e1", comportamento: "INCLUSO_NO_SERVICO" } });
    const daOutra = await prisma.categoriaProduto.findFirst({ where: { empresaId: "e2" } });
    const r = await produtos("POST", { nome: "Compressor 1/4", unidade: "un", categoriaProdutoId: pecas.id });
    expect(r.status).toBe(201);
    expect(r.json.categoriaProduto).toEqual({ id: pecas.id, nome: "Peças de reposição", comportamento: "VENDA_A_PARTE", ativo: true });
    const sem = await produtos("POST", { nome: "Fita aluminizada", unidade: "un" });
    expect(sem.json.categoriaProduto).toBeNull();
    expect((await produtos("POST", { nome: "Errado", unidade: "un", categoriaProdutoId: daOutra.id })).status).toBe(400);
    const ed = await produtos("PATCH", { categoriaProdutoId: materiais.id }, r.json.id);
    expect(ed.json.categoriaProduto).toMatchObject({ id: materiais.id, nome: "Materiais de instalação/consumo", comportamento: "INCLUSO_NO_SERVICO" });
    expect((await produtos("PATCH", { categoriaProdutoId: "" }, r.json.id)).json.categoriaProduto).toBeNull();
    await produtos("PATCH", { categoriaProdutoId: pecas.id }, r.json.id);
    const lista = (await produtos("GET", undefined, undefined, "?pagina=1&por=25")).json;
    expect(lista.itens.map((p: any) => [p.nome, p.categoriaProduto?.nome ?? null])).toEqual([["Compressor 1/4", "Peças de reposição"], ["Fita aluminizada", null]]);
    expect((await produtos("GET", undefined, undefined, `?pagina=1&por=25&categoria=${pecas.id}`)).json.itens.map((p: any) => p.nome)).toEqual(["Compressor 1/4"]);
    expect((await produtos("GET", undefined, undefined, "?pagina=1&por=25&categoria=sem")).json.itens.map((p: any) => p.nome)).toEqual(["Fita aluminizada"]);
    // Produto da outra empresa apontando para a categoria (não acontece pela rota; simula): não entra no impacto
    await prisma.produto.create({ data: { empresaId: "e2", nome: "Da outra", unidade: "un", categoriaProdutoId: pecas.id } });
    expect((await impacto(pecas.id)).json.usos).toEqual([{ rotulo: "1 produto", total: 1 }]);
  });
});
