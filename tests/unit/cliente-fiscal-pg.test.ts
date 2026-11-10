/**
 * Cliente — Informações fiscais: as colunas novas (optanteSimples, indicadorInscricaoEstadual,
 * inscricaoMunicipal, inscricaoSuframa; inscricaoEstadual reaproveitada) são salvas no CREATE e no
 * EDIT — o PUT não ignora nem zera. Rota real com Prisma num PostgreSQL real (schema descartável).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/cliente-fiscal-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_cliente_fiscal_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId, role: "ADMIN", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await carregar();
  const req = new NextRequest("http://localhost/api/clientes", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const criarCliente = (corpo: unknown) => chamar(() => import("@/app/api/clientes/route"), "POST", {}, corpo);
const editarCliente = (id: string, corpo: unknown) => chamar(() => import("@/app/api/clientes/[id]/route"), "PUT", { id }, corpo);

const base = { tipoPessoa: "JURIDICA", nome: "Condomínio Alfa", cpfCnpj: "11.222.333/0001-81" };

describe.skipIf(!URL_PG)("Cliente › Informações fiscais (PostgreSQL real)", () => {
  let prisma: any;
  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([import("@/app/api/clientes/route"), import("@/app/api/clientes/[id]/route")]);
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

  it("CREATE salva os campos fiscais; EDIT atualiza sem zerar", async () => {
    const r = await criarCliente({ ...base, optanteSimples: true, indicadorInscricaoEstadual: "CONTRIBUINTE", inscricaoEstadual: "123.456.789", inscricaoMunicipal: "98765", inscricaoSuframa: "SUF-001" });
    expect(r.status).toBe(201);
    const id = r.json.id;
    let c = await prisma.cliente.findUnique({ where: { id } });
    expect([c.optanteSimples, c.indicadorInscricaoEstadual, c.inscricaoEstadual, c.inscricaoMunicipal, c.inscricaoSuframa])
      .toEqual([true, "CONTRIBUINTE", "123.456.789", "98765", "SUF-001"]);

    // EDIT: muda os valores; o PUT grava os novos e não zera os que vieram no corpo.
    const e = await editarCliente(id, { ...base, optanteSimples: false, indicadorInscricaoEstadual: "ISENTO", inscricaoEstadual: "ISENTO", inscricaoMunicipal: "11111", inscricaoSuframa: "SUF-002" });
    expect(e.status).toBe(200);
    c = await prisma.cliente.findUnique({ where: { id } });
    expect([c.optanteSimples, c.indicadorInscricaoEstadual, c.inscricaoEstadual, c.inscricaoMunicipal, c.inscricaoSuframa])
      .toEqual([false, "ISENTO", "ISENTO", "11111", "SUF-002"]);
  });

  it("indicador inválido é rejeitado; vazio vira null", async () => {
    const mau = await criarCliente({ ...base, cpfCnpj: "11.444.777/0001-61", indicadorInscricaoEstadual: "XPTO" });
    expect(mau.status).toBe(400);
    const ok = await criarCliente({ ...base, cpfCnpj: "11.444.777/0001-61", indicadorInscricaoEstadual: "" });
    expect(ok.status).toBe(201);
    const c = await prisma.cliente.findUnique({ where: { id: ok.json.id } });
    expect(c.indicadorInscricaoEstadual).toBeNull();
  });
});
