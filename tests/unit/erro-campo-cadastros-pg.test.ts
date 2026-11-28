/**
 * ERRO NO CAMPO — o servidor dos cadastros (lib/cadastros: registro, servidor, específicos) diz em QUAL campo o erro
 * mora, sem mudar o `erro` de sempre:
 *  - pura: `camposValidacao` põe cada erro do zod na chave do registro (a mesma do `name` da gaveta); campo
 *    desconhecido fica só na mensagem geral;
 *  - PostgreSQL real: criar/editar com dado inválido → `campos`; repetido (documento do fornecedor, nome do centro de
 *    custo/categoria, código do serviço) → `campos` no campo certo; a mensagem geral continua igual.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/erro-campo-cadastros-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { CADASTROS, camposValidacao, mensagemValidacao } from "@/lib/cadastros/registro";
import { permissoesTotais } from "@/lib/permissoes";

// A rota de verdade (lib/cadastros/rotas) com a sessão da Paula (ADMIN da empresa e1)
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u1", name: "Paula", empresaId: "e1", role: "ADMIN", permissoes: {} } }) }));

describe("camposValidacao (pura)", () => {
  it("cada erro na chave do registro; a mensagem geral continua a de sempre", () => {
    const def = CADASTROS.fornecedores;
    const p = def.schemaCriar.safeParse({ nome: "", email: "x@" });
    expect(p.success).toBe(false);
    const campos = camposValidacao(p.error!, def);
    expect(Object.keys(campos).sort()).toEqual(["email", "nome"]);
    expect(campos.nome).toBe("Nome é obrigatório.");
    expect(mensagemValidacao(p.error!, def)).toMatch(/^Nome \/ razão social: /);
  });
  it("campo desconhecido não vira campo (fica só na mensagem geral)", () => {
    const def = CADASTROS.fornecedores;
    const p = def.schemaCriar.safeParse({ nome: "Frigelar", inventado: 1 });
    expect(p.success).toBe(false);
    expect(camposValidacao(p.error!, def)).toEqual({});
    expect(mensagemValidacao(p.error!, def)).toBe("Campo não permitido: inventado.");
  });
});

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_erro_campo_cad_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

describe.skipIf(!URL_PG)("cadastros no PostgreSQL real: { erro, campos }", () => {
  let prisma: any;
  let srv: typeof import("@/lib/cadastros/servidor");
  const ator = { id: "u1", nome: "Paula", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais() } as any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    srv = await import("@/lib/cadastros/servidor");
    await prisma.empresa.create({ data: { id: "e1", nome: "Polar Demo", cnpj: "11.222.333/0001-81", email: "e@polar.ficticio" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Paula", email: "paula@polar.ficticio", senha: "x", role: "ADMIN" } });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("dado inválido: 400 com a mensagem de sempre + campos", async () => {
    const r = await srv.criarCadastro(CADASTROS.fornecedores, ator, { nome: "Frigelar", email: "x@" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.erro).toMatch(/^E-mail: /);
    expect(Object.keys(r.campos ?? {})).toEqual(["email"]);
  });

  it("documento repetido do fornecedor: 409 no campo `documento`", async () => {
    const a = await srv.criarCadastro(CADASTROS.fornecedores, ator, { nome: "Frigelar Matriz", documento: "11.222.333/0001-81" });
    expect(a.ok).toBe(true);
    const b = await srv.criarCadastro(CADASTROS.fornecedores, ator, { nome: "Frigelar Filial", documento: "11.222.333/0001-81" });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.status).toBe(409);
    expect(b.erro).toContain("Já existe um fornecedor com este CNPJ/CPF");
    expect(b.campos).toEqual({ documento: b.erro });
  });

  it("nome repetido (centro de custo) e na edição: 409 no campo `nome`", async () => {
    const a = await srv.criarCadastro(CADASTROS["centros-custo"], ator, { nome: "Frota" });
    expect(a.ok).toBe(true);
    const b = await srv.criarCadastro(CADASTROS["centros-custo"], ator, { nome: "frota" });
    expect(!b.ok && b.campos).toEqual({ nome: (b as any).erro });
    const c = await srv.criarCadastro(CADASTROS["centros-custo"], ator, { nome: "Obra Norte" });
    const d = await srv.editarCadastro(CADASTROS["centros-custo"], ator, (c as any).item.id, { nome: "Frota" });
    expect(!d.ok && d.status).toBe(409);
    expect(!d.ok && Object.keys(d.campos ?? {})).toEqual(["nome"]);
  });

  it("código de serviço repetido: 409 no campo `codigo`", async () => {
    const a = await srv.criarCadastro(CADASTROS.servicos, ator, { nome: "Limpeza", codigo: "LIMP1" });
    expect(a.ok).toBe(true);
    const b = await srv.criarCadastro(CADASTROS.servicos, ator, { nome: "Limpeza 2", codigo: "LIMP1" });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.status).toBe(409);
    expect(Object.keys(b.campos ?? {})).toEqual(["codigo"]);
  });

  it("a rota responde { erro, campos } (e só { erro } quando o erro não é de campo)", async () => {
    const { rotasColecao } = await import("@/lib/cadastros/rotas");
    const { NextRequest } = await import("next/server");
    const r = rotasColecao();
    const post = (corpo: unknown) => r.POST(new NextRequest("http://x/api/cadastros/fornecedores", { method: "POST", body: JSON.stringify(corpo) }), { params: Promise.resolve({ entidade: "fornecedores" }) });
    const dup = await post({ nome: "Outro", documento: "11.222.333/0001-81" });
    expect(dup.status).toBe(409);
    const corpo = await dup.json();
    expect(Object.keys(corpo).sort()).toEqual(["campos", "erro"]);
    expect(corpo.campos).toEqual({ documento: corpo.erro });
    // sem campo (campo desconhecido): o { erro } de sempre, sem `campos`
    const fora = await post({ nome: "Outro", inventado: 1 });
    expect(fora.status).toBe(400);
    expect(await fora.json()).toEqual({ erro: "Campo não permitido: inventado." });
    const ok = await post({ nome: "Sem documento" });
    expect(ok.status).toBe(201);
  });
});
