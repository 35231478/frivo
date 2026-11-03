/**
 * Rota /api/preferencias/[chave] (GET/PUT) com o Prisma real num PostgreSQL real (schema descartável
 * via `prisma db push`): só a preferência do PRÓPRIO usuário da sessão; outro usuário (mesmo da mesma
 * empresa) não vê nem sobrescreve; sem sessão = 401; chave ou corpo torto = 400; não precisa de permissão.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/preferencias-api-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesVazias } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pref_api_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (id: string, empresaId = "e1") => {
  // Permissões VAZIAS de propósito: preferência pessoal não depende de módulo nenhum
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes: permissoesVazias(), tecnicoId: null } };
};

async function chamar(metodo: "GET" | "PUT", chave: string, corpo?: unknown) {
  const mod = await import("@/app/api/preferencias/[chave]/route");
  const req = new NextRequest(`http://localhost/api/preferencias/${chave}`, { method: metodo, headers: { "Content-Type": "application/json" }, ...(corpo !== undefined && { body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }) });
  const res = await mod[metodo](req, { params: Promise.resolve({ chave }) });
  return { status: res.status, json: await res.json() };
}

describe.skipIf(!URL_PG)("/api/preferencias/[chave] (PostgreSQL real)", () => {
  let prisma: any;
  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u2", empresaId: "e1", nome: "Beto", email: "b@x.com", senha: "x" },
      { id: "u3", empresaId: "e2", nome: "Caio", email: "c@x.com", senha: "x" },
    ] });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("sem sessão: 401 nos dois verbos (nada é lido nem gravado)", async () => {
    sessao.atual = null;
    expect((await chamar("GET", "tabela:orcamentos")).status).toBe(401);
    expect((await chamar("PUT", "tabela:orcamentos", { larguras: {} })).status).toBe(401);
    expect(await prisma.preferenciaUsuario.count()).toBe(0);
  });

  it("GET sem nada guardado devolve valor null; PUT grava e o GET devolve o que foi gravado", async () => {
    logar("u1");
    expect(await chamar("GET", "tabela:orcamentos")).toEqual({ status: 200, json: { chave: "tabela:orcamentos", valor: null } });
    const r = await chamar("PUT", "tabela:orcamentos", { larguras: { nome: 320, valor: 110 }, ocultas: ["tipo"] });
    expect(r).toEqual({ status: 200, json: { chave: "tabela:orcamentos", valor: { larguras: { nome: 320, valor: 110 }, ocultas: ["tipo"] } } });
    expect((await chamar("GET", "tabela:orcamentos")).json.valor).toEqual({ larguras: { nome: 320, valor: 110 }, ocultas: ["tipo"] });
  });

  it("PUT de novo atualiza a MESMA linha (uma por usuário e chave); outra chave é outra linha", async () => {
    logar("u1");
    await chamar("PUT", "tabela:orcamentos", { larguras: { nome: 400 } });
    expect((await chamar("GET", "tabela:orcamentos")).json.valor).toEqual({ larguras: { nome: 400 } });
    await chamar("PUT", "tabela:cadastro-produtos", { larguras: {}, ocultas: [] });
    expect(await prisma.preferenciaUsuario.count({ where: { usuarioId: "u1" } })).toBe(2);
  });

  it("isolamento: outro usuário da mesma empresa (e de outra) não vê a do u1 e, ao gravar, não mexe na dele", async () => {
    logar("u2");
    expect((await chamar("GET", "tabela:orcamentos")).json.valor).toBeNull();
    await chamar("PUT", "tabela:orcamentos", { larguras: { nome: 100 } });
    logar("u3", "e2");
    expect((await chamar("GET", "tabela:orcamentos")).json.valor).toBeNull();
    logar("u1");
    expect((await chamar("GET", "tabela:orcamentos")).json.valor).toEqual({ larguras: { nome: 400 } });
    expect(await prisma.preferenciaUsuario.count({ where: { chave: "tabela:orcamentos" } })).toBe(2);
  });

  it("chave fora do padrão = 400 (GET e PUT), sem tocar no banco", async () => {
    logar("u1");
    const antes = await prisma.preferenciaUsuario.count();
    for (const chave of ["orcamentos", "tabela:Orcamentos", "painel:x", "tabela:a%2Fb"]) {
      expect((await chamar("GET", chave)).status).toBe(400);
      expect((await chamar("PUT", chave, { larguras: {} })).status).toBe(400);
    }
    expect(await prisma.preferenciaUsuario.count()).toBe(antes);
  });

  it("corpo torto = 400 com os detalhes (largura fora da faixa, campo estranho, JSON inválido)", async () => {
    logar("u1");
    expect((await chamar("PUT", "tabela:os", { larguras: { numero: 10 } })).status).toBe(400);
    expect((await chamar("PUT", "tabela:os", { larguras: {}, cor: "azul" })).status).toBe(400);
    expect((await chamar("PUT", "tabela:os", "{nao-json")).status).toBe(400);
    expect((await chamar("GET", "tabela:os")).json.valor).toBeNull();
  });

  it("JSON torto gravado por fora não quebra o GET: volta como 'sem preferência'", async () => {
    await prisma.preferenciaUsuario.upsert({ where: { usuarioId_chave: { usuarioId: "u1", chave: "tabela:nfse" } }, create: { usuarioId: "u1", chave: "tabela:nfse", valor: { larguras: { a: -5 } } }, update: { valor: { larguras: { a: -5 } } } });
    logar("u1");
    expect((await chamar("GET", "tabela:nfse")).json.valor).toEqual({ larguras: {} });
  });
});
