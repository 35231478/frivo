/**
 * OS-B — "Criar orçamento" de dentro da OS, pelas rotas reais com o Prisma real num PostgreSQL real:
 *  - os dados do construtor (mesma fonte da página /orcamentos/novo) exigem orcamentos.criar,
 *    vêm só da empresa da sessão e já trazem o cliente da OS;
 *  - salvar pelo mesmo POST /api/orcamentos vincula à OS (aparece no detalhe da OS);
 *  - OS de outro cliente/empresa no vínculo é recusada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-orcamento-inline-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_os_orc_inline_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes } };
};
const sem = (modulo: string, acao: string) => {
  const p = permissoesTotais() as any;
  p[modulo] = { ...p[modulo], [acao]: false };
  return p as Permissoes;
};

async function chamar(rota: string, metodo: string, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("OS-B: orçamento criado de dentro da OS (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["orcamentos", "orcamentos/form-dados"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "c2", empresaId: "e1", nome: "Padaria Pão Quente", cpfCnpj: "22333444000190" },
      { id: "cInativo", empresaId: "e1", nome: "Cliente inativo", cpfCnpj: "55666777000100", ativo: false },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "33444555000100" },
    ] });
    await prisma.servico.createMany({ data: [
      { id: "s1", empresaId: "e1", nome: "Limpeza de split", valorPadrao: 180 },
      { id: "sE2", empresaId: "e2", nome: "Serviço da outra", valorPadrao: 1 },
    ] });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-2026-0001", clienteId: "c1", criadoPorId: "u1", descricao: "Corretiva no split" },
      { id: "os2", empresaId: "e1", numero: "OS-2026-0002", clienteId: "c2", criadoPorId: "u1", descricao: "Preventiva" },
      { id: "osE2", empresaId: "e2", numero: "OS-2026-0001", clienteId: "cE2", criadoPorId: "u2", descricao: "Da outra empresa" },
    ] });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("dados do construtor: só da empresa, só ativos, com o cliente e a OS de origem já escolhidos", async () => {
    const r = await chamar("orcamentos/form-dados", "GET", undefined, "?osId=os1");
    expect(r.status).toBe(200);
    expect(r.json.clienteIdInicial).toBe("c1");
    expect(r.json.osInicialId).toBe("os1");
    expect(r.json.osInicial).toEqual({ id: "os1", numero: "OS-2026-0001", descricao: "Corretiva no split", status: "ABERTA" });
    expect(r.json.clientes.map((c: any) => c.id)).toEqual(["c1", "c2"]);
    expect(r.json.catalogoServicos).toEqual([expect.objectContaining({ id: "s1", nome: "Limpeza de split", valorPadrao: 180 })]); // número, não Decimal
  });

  it("dados do construtor: sem orcamentos.criar = 403; OS de outra empresa = 404", async () => {
    logar(sem("orcamentos", "criar"));
    expect((await chamar("orcamentos/form-dados", "GET", undefined, "?osId=os1")).status).toBe(403);
    logar();
    expect((await chamar("orcamentos/form-dados", "GET", undefined, "?osId=osE2")).status).toBe(404);
    logar(permissoesTotais(), "e2", "u2");
    expect((await chamar("orcamentos/form-dados", "GET", undefined, "?osId=os1")).status).toBe(404);
    logar();
  });

  it("salvar pela mesma API cria o orçamento JÁ vinculado à OS (aparece no detalhe da OS)", async () => {
    const r = await chamar("orcamentos", "POST", {
      nome: "Troca de capacitor", clienteId: "c1", tipo: "COMUM", ordensServicoIds: ["os1"],
      servicos: [{ catalogoId: "s1", descricao: "Limpeza de split", quantidade: 2, valorUnitario: 180 }], produtos: [],
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ nome: "Troca de capacitor", clienteId: "c1", status: "RASCUNHO" });
    const os = await prisma.ordemServico.findUnique({ where: { id: "os1" }, include: { orcamentos: { include: { orcamento: true } } } });
    expect(os.orcamentos.map((v: any) => [v.orcamento.codigo, Number(v.orcamento.totalGeral)])).toEqual([[r.json.codigo, 360]]);
  });

  it("vínculo com OS de outro cliente ou de outra empresa é recusado (nada é criado)", async () => {
    const antes = await prisma.orcamento.count();
    for (const os of ["os2", "osE2"]) {
      const r = await chamar("orcamentos", "POST", {
        nome: "X", clienteId: "c1", tipo: "COMUM", ordensServicoIds: [os],
        servicos: [{ descricao: "Item", quantidade: 1, valorUnitario: 10 }], produtos: [],
      });
      expect(r.status).toBe(400);
    }
    expect(await prisma.orcamento.count()).toBe(antes);
    logar(sem("orcamentos", "criar"));
    expect((await chamar("orcamentos", "POST", { nome: "X", clienteId: "c1", ordensServicoIds: ["os1"], servicos: [], produtos: [] })).status).toBe(403);
    logar();
  });
});
