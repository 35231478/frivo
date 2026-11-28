/**
 * ERRO NO CAMPO — a API de clientes diz em qual campo está o erro ({ erro, campos }), contra PostgreSQL real:
 *  - CNPJ inválido e CPF/CNPJ já cadastrado (POST e PUT) → campos.cpfCnpj (o `erro` de sempre continua);
 *  - o zod que recusa → o mesmo { erro: "Dados inválidos", detalhes } de antes + campos;
 *  - "exigir endereço" da empresa → campos.endereco.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/erro-campo-cliente-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import { lerErroDaApi } from "@/lib/forms/erros";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_erro_campo_cli_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("erro no campo — API de clientes (PostgreSQL real)", () => {
  let prisma: any;
  const pedir = async (metodo: "POST" | "PUT", corpo: unknown, id?: string) => {
    const req = new NextRequest(`http://localhost/api/clientes${id ? `/${id}` : ""}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const res = id
      ? await (await import("@/app/api/clientes/[id]/route")).PUT(req, { params: Promise.resolve({ id }) })
      : await (await import("@/app/api/clientes/route")).POST(req);
    return { status: res.status, json: await res.json() };
  };
  const base = { tipoPessoa: "JURIDICA", nome: "Polar Demo Refrigeração" };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.empresa.create({ data: { id: "e1", nome: "Polar Demo", cnpj: "11222333000181", email: "e1@polar.ficticio" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Paula", email: "paula@polar.ficticio", senha: "x" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Cliente Um", cpfCnpj: "11.444.777/0001-61", tipoPessoa: "JURIDICA" } });
    await prisma.cliente.create({ data: { id: "c2", empresaId: "e1", nome: "Cliente Dois", cpfCnpj: "45723174000110", tipoPessoa: "JURIDICA" } });
    sessao.atual = { user: { id: "u1", name: "Paula", email: "paula@polar.ficticio", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } };
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("CNPJ inválido: 400 com o erro no cpfCnpj", async () => {
    const r = await pedir("POST", { ...base, cpfCnpj: "11.222.333/0001-80" });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ erro: "CNPJ inválido: confira os 14 dígitos.", campos: { cpfCnpj: "CNPJ inválido: confira os 14 dígitos." } });
  });

  it("CPF/CNPJ já cadastrado (POST e PUT): 409 com o erro no cpfCnpj", async () => {
    const r = await pedir("POST", { ...base, cpfCnpj: "11444777000161" });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ erro: "CPF/CNPJ já cadastrado", campos: { cpfCnpj: "CPF/CNPJ já cadastrado" } });
    const p = await pedir("PUT", { ...base, cpfCnpj: "45.723.174/0001-10" }, "c1");
    expect(p.status).toBe(409);
    expect(p.json.campos).toEqual({ cpfCnpj: "CPF/CNPJ já cadastrado" });
  });

  it("o zod recusa: o mesmo { erro, detalhes } de antes + campos (quem lê só o `erro` não quebra)", async () => {
    const r = await pedir("POST", { ...base, nome: "P", cpfCnpj: "123" });
    expect(r.status).toBe(400);
    expect(r.json.erro).toBe("Dados inválidos");
    expect(r.json.detalhes.fieldErrors.nome).toEqual(["Nome deve ter pelo menos 2 caracteres"]);
    expect(r.json.campos).toEqual({ nome: "Nome deve ter pelo menos 2 caracteres", cpfCnpj: "CPF/CNPJ inválido" });
    expect(lerErroDaApi(r.json)).toEqual({ geral: null, campos: r.json.campos });
  });

  it("\"exigir endereço\" da empresa: o erro no endereço principal", async () => {
    await prisma.configuracao.upsert({ where: { empresaId: "e1" }, create: { empresaId: "e1", clienteExigirUnidade: true }, update: { clienteExigirUnidade: true } });
    const r = await pedir("POST", { ...base, cpfCnpj: "11.222.333/0001-81" });
    expect(r.status).toBe(400);
    expect(Object.keys(r.json.campos)).toEqual(["endereco"]);
    expect(r.json.erro).toBe(r.json.campos.endereco);
  });
});
