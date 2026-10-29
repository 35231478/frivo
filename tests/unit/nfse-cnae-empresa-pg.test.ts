/**
 * NFS-e — CNAE principal da empresa e o apoio da seção fiscal, pelas rotas REAIS com o Prisma num
 * PostgreSQL real:
 *  - PUT /api/empresa grava o CNAE normalizado ("4322-3/02" → "4322302"), limpa com vazio, recusa
 *    inválido (400) e, sem Financeiro › Fiscal, recusa MUDAR (403, nada gravado) mas aceita o mesmo
 *    valor (a tela manda o formulário inteiro); ADMIN passa;
 *  - GET /api/fiscal/apoio-servico: CNAE e ISS da EMPRESA DA SESSÃO + códigos municipais já usados
 *    só dos serviços dela; sem sessão = 401.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/nfse-cnae-empresa-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_nfse_cnae_empresa_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const GESTOR = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
const GESTOR_FISCAL = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fiscal"] });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes, o: { empresaId?: string; role?: string } = {}) => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: o.empresaId ?? "e1", role: o.role ?? "OPERADOR", permissoes } };
};

async function putEmpresa(corpo: unknown) {
  const mod = await import("@/app/api/empresa/route");
  const res = await mod.PUT(new NextRequest("http://localhost/api/empresa", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
async function getEmpresa() {
  const mod = await import("@/app/api/empresa/route");
  const res = await mod.GET();
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
async function apoio() {
  const mod = await import("@/app/api/fiscal/apoio-servico/route");
  const res = await mod.GET();
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

describe.skipIf(!URL_PG)("NFS-e: CNAE principal da empresa + apoio da seção fiscal (PostgreSQL real)", () => {
  let prisma: any;
  const cnae = async (id = "e1") => (await prisma.empresa.findUnique({ where: { id }, select: { cnaePrincipal: true } })).cnaePrincipal;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([import("@/app/api/empresa/route"), import("@/app/api/fiscal/apoio-servico/route")]);
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com", cnaePrincipal: "6201501" },
    ] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1", issAliquota: 3.5 }, { empresaId: "e2", issAliquota: 2 }] });
    await prisma.servico.createMany({ data: [
      { id: "s1", empresaId: "e1", nome: "Limpeza", unidade: "un", codigoMunicipal: "140101" },
      { id: "s2", empresaId: "e1", nome: "Higienização", unidade: "un", codigoMunicipal: "140101" },
      { id: "s3", empresaId: "e1", nome: "Sem código", unidade: "un" },
      { id: "sB", empresaId: "e2", nome: "Da outra", unidade: "un", codigoMunicipal: "999" },
    ] });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(() => logar(GESTOR_FISCAL));

  it("grava normalizado, o GET devolve, vazio limpa; nada além da empresa da sessão muda", async () => {
    expect((await putEmpresa({ cnaePrincipal: "4322-3/02" })).status).toBe(200);
    expect(await cnae()).toBe("4322302");
    expect((await getEmpresa()).json.cnaePrincipal).toBe("4322302");
    expect((await putEmpresa({ nome: "Clima Total Ltda" })).status).toBe(200); // sem o campo: não mexe
    expect(await cnae()).toBe("4322302");
    expect((await putEmpresa({ cnaePrincipal: "" })).status).toBe(200);
    expect(await cnae()).toBeNull();
    expect((await putEmpresa({ cnaePrincipal: null })).status).toBe(200);
    expect(await cnae("e2")).toBe("6201501");
  });

  it("inválido = 400 com a mensagem do CNAE, nada gravado", async () => {
    await prisma.empresa.update({ where: { id: "e1" }, data: { cnaePrincipal: "4322302" } });
    expect(await putEmpresa({ cnaePrincipal: "43223" })).toMatchObject({ status: 400, json: { erro: "CNAE inválido: use os 7 dígitos da subclasse (ex.: 4321-5/00)." } });
    expect(await putEmpresa({ cnaePrincipal: true })).toMatchObject({ status: 400 });
    expect(await cnae()).toBe("4322302");
    expect((await putEmpresa({ cnaePrincipal: 4321500 })).status).toBe(200); // número (planilha/integração) também vale
    expect(await cnae()).toBe("4321500");
  });

  it("sem Financeiro › Fiscal: o mesmo valor passa (formulário inteiro), mudar = 403 e nada gravado; ADMIN passa", async () => {
    await prisma.empresa.update({ where: { id: "e1" }, data: { cnaePrincipal: "4322302" } });
    logar(GESTOR);
    expect((await putEmpresa({ nome: "Clima" })).status).toBe(200); // sem o campo: o Fiscal não é exigido
    expect((await putEmpresa({ nome: "Clima", cnaePrincipal: "4322-3/02" })).status).toBe(200);
    const r = await putEmpresa({ nome: "Outro nome", cnaePrincipal: "4321500" });
    expect(r).toEqual({ status: 403, json: { erro: "Sem permissão para alterar o CNAE principal. Exige a permissão Financeiro › Fiscal (NFS-e)." } });
    expect((await prisma.empresa.findUnique({ where: { id: "e1" } }))).toMatchObject({ nome: "Clima", cnaePrincipal: "4322302" });
    expect((await putEmpresa({ cnaePrincipal: "" })).status).toBe(403);
    await prisma.empresa.update({ where: { id: "e1" }, data: { cnaePrincipal: null } });
    expect((await putEmpresa({ cnaePrincipal: "" })).status).toBe(200); // vazio com vazio gravado: não muda
    expect((await putEmpresa({ cnaePrincipal: "4321500" })).status).toBe(403);
    logar(GESTOR, { role: "ADMIN" });
    expect((await putEmpresa({ cnaePrincipal: "4321500" })).status).toBe(200);
    expect(await cnae()).toBe("4321500");
    logar(montarPermissoes({ financeiro: ["visualizar", "fiscal"] }));
    expect((await putEmpresa({ cnaePrincipal: "4322302" })).status).toBe(403); // sem gerenciar a empresa
    expect(await cnae()).toBe("4321500");
  });

  it("apoio da seção fiscal: só a empresa da sessão; sem sessão = 401", async () => {
    await prisma.empresa.update({ where: { id: "e1" }, data: { cnaePrincipal: "4322302" } });
    logar(montarPermissoes({}));
    const r = await apoio();
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      cnaeEmpresa: "4322302", issEmpresa: 3.5,
      servicos: [{ codigoMunicipal: "140101", nome: "Higienização" }, { codigoMunicipal: "140101", nome: "Limpeza" }],
    });
    logar(GESTOR, { empresaId: "e2" });
    expect((await apoio()).json).toEqual({ cnaeEmpresa: "6201501", issEmpresa: 2, servicos: [{ codigoMunicipal: "999", nome: "Da outra" }] });
    await prisma.configuracao.delete({ where: { empresaId: "e2" } });
    expect((await apoio()).json.issEmpresa).toBeNull();
    sessao.atual = null;
    expect((await apoio()).status).toBe(401);
    sessao.atual = { expires: "x" }; // sessão sem usuário
    expect((await apoio()).status).toBe(401);
  });
});
