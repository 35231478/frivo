/**
 * Leva I.2 — grupo A, com as rotas reais, o Prisma real e um PostgreSQL real (schema descartável via
 * `prisma db push`). Dados fictícios.
 *  1 — Nova senha provisória do 1º administrador (só o dono do Frivo): o ADMIN ativo mais antigo; hash + troca
 *      obrigatória; a sessão antiga cai; o bloqueio por senha errada é zerado; a trilha sem a senha.
 *  2 — Editar os dados da empresa: CNPJ válido e único, "campo: antes → depois" na trilha, nada mudou = nada gravado;
 *      o Histórico (GET) com quem fez; inativar/reativar também entram na trilha.
 *  3 — E-mail de login único no Frivo inteiro: Configurações › Usuários, acesso ao app, ficha do colaborador,
 *      acesso ao portal (liberar, gerar senha, editar o contato), Meu perfil e Nova empresa. Usuários e contatos de
 *      portal são espaços separados.
 *  4 — CSV contra fórmula: exportar (o pacote de verdade) e importar de volta pela Implantação devolve o valor original.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva-i2-a-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import { impressaoDaSenha } from "@/lib/acesso/impressao-senha";
import { caixaNome } from "@/lib/texto/zod";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva_i2a_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("resend", () => ({ Resend: class { emails = { send: async () => ({ data: { id: "x" } }) }; } }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const como = (role: string, id: string, empresaId: string) => {
  sessao.atual = { user: { id, name: "Pessoa Teste", email: `${id}@ficticio.test`, empresaId, role, permissoes: permissoesTotais(), tecnicoId: null } };
};
const semSessao = () => { sessao.atual = null; };
const dono = () => como("SUPER_ADMIN", "uDono", "eF");

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null, res };
}

/** Lê o zip da exportação (com o zipfile do Python, que confere o CRC) → { nome: texto } */
function abrirZip(bytes: Uint8Array): Record<string, string> {
  const dir = mkdtempSync(path.join(tmpdir(), "leva-i2a-"));
  try {
    const arq = path.join(dir, "pacote.zip");
    writeFileSync(arq, bytes);
    const json = execFileSync("python3", ["-I", "-c", [
      "import sys, json, zipfile",
      "z = zipfile.ZipFile(sys.argv[1])",
      "print(json.dumps({n: z.read(n).decode('utf-8') for n in z.namelist()}))",
    ].join("\n"), arq], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(json);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SENHA_VELHA = "Velha@2026x";
// As mensagens vêm de lib/acesso/email-unico, que carrega @/lib/prisma: importado só depois de trocar o DATABASE_URL
let MSG_EMAIL_LOGIN_EM_USO = "";
let MSG_EMAIL_PORTAL_EM_USO = "";

describe.skipIf(!URL_PG)("Leva I.2 — grupo A (PostgreSQL real)", () => {
  let prisma: any;
  let hashVelho = "";

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    // Trava: o cliente do Prisma tem de estar no schema descartável (nunca no banco do .env)
    expect((await prisma.$queryRawUnsafe("select current_schema() as s"))[0].s).toBe(SCHEMA);
    ({ MSG_EMAIL_LOGIN_EM_USO, MSG_EMAIL_PORTAL_EM_USO } = await import("@/lib/acesso/email-unico"));
    hashVelho = await bcrypt.hash(SENHA_VELHA, 4);

    await prisma.empresa.createMany({ data: [
      { id: "eF", nome: "Frivo (fictícia)", cnpj: "45.723.174/0001-10", email: "frivo@ficticio.test" },
      { id: "eA", nome: "Clima Aurora Ltda (fictícia)", nomeFantasia: "Aurora", cnpj: "11.222.333/0001-81", email: "aurora@ficticio.test", telefone: "(11) 4000-0001" },
      { id: "eB", nome: "Clima Boreal Ltda (fictícia)", cnpj: "04252011000110", email: "boreal@ficticio.test" },
      { id: "eSem", nome: "Empresa sem administrador (fictícia)", cnpj: "03.778.130/0001-48", email: "sem@ficticio.test" },
    ] });
    await prisma.perfilAcesso.createMany({ data: [
      { id: "pTecA", empresaId: "eA", nome: "Técnico", tipo: "TECNICO", permissoes: {} },
      { id: "pOpA", empresaId: "eA", nome: "Operador", tipo: "PERSONALIZADO", permissoes: {} },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uDono", empresaId: "eF", nome: "Dono do Frivo", email: "dono@ficticio.test", senha: "x", role: "SUPER_ADMIN" },
      // eA: o ADMIN mais antigo está INATIVO; o 1º administrador é o ativo mais antigo (aPrimeiro)
      { id: "aInativo", empresaId: "eA", nome: "Admin Inativo", email: "inativo@aurora.ficticio", senha: hashVelho, role: "ADMIN", ativo: false, criadoEm: new Date("2025-01-01T12:00:00Z") },
      { id: "aOperador", empresaId: "eA", nome: "Operador Antigo", email: "operador@aurora.ficticio", senha: hashVelho, role: "OPERADOR", criadoEm: new Date("2024-06-01T12:00:00Z") },
      { id: "aPrimeiro", empresaId: "eA", nome: "Beatriz Primeira", email: "beatriz@aurora.ficticio", senha: hashVelho, role: "ADMIN", criadoEm: new Date("2025-02-01T12:00:00Z") },
      { id: "aSegundo", empresaId: "eA", nome: "Carlos Segundo", email: "carlos@aurora.ficticio", senha: hashVelho, role: "ADMIN", criadoEm: new Date("2025-03-01T12:00:00Z") },
      { id: "uB", empresaId: "eB", nome: "Joana Boreal", email: "joana@boreal.ficticio", senha: hashVelho, role: "ADMIN" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "clA", empresaId: "eA", nome: "Padaria Aurora (fictícia)", cpfCnpj: "11444777000161" },
      { id: "clB", empresaId: "eB", nome: "Mercado Boreal (fictício)", cpfCnpj: "2" },
    ] });
    await prisma.contatoCliente.createMany({ data: [
      { id: "ctB", empresaId: "eB", clienteId: "clB", nome: "Contato com portal", email: "portal@ficticio.test", senha: hashVelho },
      { id: "ctBsem", empresaId: "eB", clienteId: "clB", nome: "Contato sem portal", email: "sem-acesso@ficticio.test" },
      { id: "ctA", empresaId: "eA", clienteId: "clA", nome: "Contato da Aurora", email: "contato@aurora.ficticio" },
      { id: "ctA2", empresaId: "eA", clienteId: "clA", nome: "Outro contato da Aurora", email: "Portal@Ficticio.test" },
    ] });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────────────────────── 1 ───────────────────────── */
  describe("1 — nova senha provisória do 1º administrador", () => {
    it("só o dono do Frivo: sem sessão 401; ADMIN de empresa-cliente 403 (e nada muda)", async () => {
      semSessao();
      expect((await chamar("admin/empresas/[id]/nova-senha-admin", "POST", { id: "eA" })).status).toBe(401);
      como("ADMIN", "aSegundo", "eA");
      const r = await chamar("admin/empresas/[id]/nova-senha-admin", "POST", { id: "eA" });
      expect(r.status).toBe(403);
      expect((await prisma.usuario.findUnique({ where: { id: "aPrimeiro" } })).senha).toBe(hashVelho);
      expect(await prisma.empresaEvento.count()).toBe(0);
    });

    it("gera para o ADMIN ATIVO mais antigo: hash novo, troca obrigatória, a sessão antiga cai, o bloqueio zera; trilha sem a senha", async () => {
      const { conferirTokenAtivo } = await import("@/lib/sessao-ativa");
      const { conferirBloqueio, registrarTentativa } = await import("@/lib/acesso/limite");
      // A sessão aberta antes (impressão da senha velha) vale agora
      const tokenAntigo = { id: "aPrimeiro", empresaId: "eA", role: "ADMIN", fs: impressaoDaSenha(hashVelho) } as any;
      expect(await conferirTokenAtivo(tokenAntigo, false)).not.toBeNull();
      // Esqueceu a senha e tentou demais: bloqueado
      for (let i = 0; i < 5; i++) await registrarTentativa("LOGIN", { email: "beatriz@aurora.ficticio" });
      expect((await conferirBloqueio("LOGIN", { email: "beatriz@aurora.ficticio" })).bloqueado).toBe(true);

      dono();
      const r = await chamar("admin/empresas/[id]/nova-senha-admin", "POST", { id: "eA" });
      expect(r.status).toBe(200);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      expect(r.json.admin).toEqual({ nome: "Beatriz Primeira", email: "beatriz@aurora.ficticio" });
      expect(r.json.senha).toMatch(/^[A-Za-z0-9]{12}$/);

      const u = await prisma.usuario.findUnique({ where: { id: "aPrimeiro" } });
      expect(u.trocarSenha).toBe(true);
      expect(u.senha).not.toBe(r.json.senha);
      expect(await bcrypt.compare(r.json.senha, u.senha)).toBe(true);
      expect(await bcrypt.compare(SENHA_VELHA, u.senha)).toBe(false);
      // Os outros não mudam (o inativo mais antigo, o segundo admin, o operador)
      for (const id of ["aInativo", "aSegundo", "aOperador"]) expect((await prisma.usuario.findUnique({ where: { id } })).senha).toBe(hashVelho);

      expect(await conferirTokenAtivo(tokenAntigo, false)).toBeNull();
      expect((await conferirBloqueio("LOGIN", { email: "beatriz@aurora.ficticio" })).bloqueado).toBe(false);

      const ev = await prisma.empresaEvento.findMany({ where: { empresaId: "eA" } });
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ tipo: "NOVA_SENHA_ADMIN", usuarioId: "uDono" });
      expect(ev[0].detalhe).toContain("beatriz@aurora.ficticio");
      expect(ev[0].detalhe).not.toContain(r.json.senha);
    });

    it("empresa sem administrador ativo: 409; empresa que não existe: 404", async () => {
      dono();
      expect(await chamar("admin/empresas/[id]/nova-senha-admin", "POST", { id: "eSem" })).toMatchObject({ status: 409, json: { erro: "A empresa não tem administrador ativo." } });
      expect((await chamar("admin/empresas/[id]/nova-senha-admin", "POST", { id: "nao-existe" })).status).toBe(404);
      expect(await prisma.empresaEvento.count({ where: { empresaId: "eSem" } })).toBe(0);
    });
  });

  /* ───────────────────────── 2 ───────────────────────── */
  describe("2 — editar os dados da empresa", () => {
    const DADOS = { razaoSocial: "Clima Aurora Ltda (fictícia)", nomeFantasia: "Aurora", cnpj: "11.222.333/0001-81", email: "aurora@ficticio.test", telefone: "(11) 4000-0001" };

    it("só o dono do Frivo (GET e PUT): ADMIN de empresa-cliente 403", async () => {
      como("ADMIN", "aSegundo", "eA");
      expect((await chamar("admin/empresas/[id]", "GET", { id: "eA" })).status).toBe(403);
      expect((await chamar("admin/empresas/[id]", "PUT", { id: "eA" }, { ...DADOS, razaoSocial: "Invadida" })).status).toBe(403);
      expect((await prisma.empresa.findUnique({ where: { id: "eA" } })).nome).toBe(DADOS.razaoSocial);
    });

    it("CNPJ inválido 400; CNPJ de outra empresa (com ou sem máscara) 409; campo desconhecido 400", async () => {
      dono();
      expect((await chamar("admin/empresas/[id]", "PUT", { id: "eA" }, { ...DADOS, cnpj: "11.222.333/0001-00" })).json).toMatchObject({ erro: "CNPJ inválido.", campo: "cnpj" });
      expect(await chamar("admin/empresas/[id]", "PUT", { id: "eA" }, { ...DADOS, cnpj: "04.252.011/0001-10" })).toMatchObject({ status: 409, json: { erro: "Já existe uma empresa com este CNPJ." } });
      expect((await chamar("admin/empresas/[id]", "PUT", { id: "eA" }, { ...DADOS, cnpj: "45723174000110" })).status).toBe(409);
      expect((await chamar("admin/empresas/[id]", "PUT", { id: "eA" }, { ...DADOS, ativo: false })).status).toBe(400);
      expect((await chamar("admin/empresas/[id]", "PUT", { id: "nao-existe" }, DADOS)).status).toBe(404);
      expect(await prisma.empresaEvento.count({ where: { tipo: "DADOS_EDITADOS" } })).toBe(0);
    });

    it("grava, e a trilha diz campo: antes → depois; o mesmo CNPJ da própria empresa não conflita; sem mudança, nada é gravado", async () => {
      dono();
      const r = await chamar("admin/empresas/[id]", "PUT", { id: "eA" }, { ...DADOS, razaoSocial: "Clima Aurora Serviços Ltda (fictícia)", nomeFantasia: "", cnpj: "11444777000161", email: "Novo@Aurora.Ficticio" });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ ok: true, alterado: true, empresa: { cnpj: "11.444.777/0001-61", nomeFantasia: null, email: "novo@aurora.ficticio" } });
      expect(await prisma.empresa.findUnique({ where: { id: "eA" }, select: { nome: true, nomeFantasia: true, cnpj: true, email: true, telefone: true } })).toEqual({
        nome: "Clima Aurora Serviços Ltda (fictícia)", nomeFantasia: null, cnpj: "11.444.777/0001-61", email: "novo@aurora.ficticio", telefone: "(11) 4000-0001",
      });
      const ev = await prisma.empresaEvento.findFirst({ where: { empresaId: "eA", tipo: "DADOS_EDITADOS" } });
      expect(ev.usuarioId).toBe("uDono");
      expect(ev.detalhe.split("\n")).toEqual([
        "Razão social: Clima Aurora Ltda (fictícia) → Clima Aurora Serviços Ltda (fictícia)",
        "Nome fantasia: Aurora → (vazio)",
        "CNPJ: 11.222.333/0001-81 → 11.444.777/0001-61",
        "E-mail: aurora@ficticio.test → novo@aurora.ficticio",
      ]);

      // Enviar de novo o mesmo (CNPJ sem máscara, e-mail em maiúsculas): nada mudou, nenhum evento novo
      const igual = await chamar("admin/empresas/[id]", "PUT", { id: "eA" }, { razaoSocial: "Clima Aurora Serviços Ltda (fictícia)", nomeFantasia: null, cnpj: "11.444.777/0001-61", email: "NOVO@aurora.ficticio", telefone: "(11) 4000-0001" });
      expect(igual.json).toMatchObject({ ok: true, alterado: false });
      expect(await prisma.empresaEvento.count({ where: { tipo: "DADOS_EDITADOS" } })).toBe(1);
    });

    it("o Histórico (GET): os dados de agora e a trilha recente, do mais novo ao mais antigo, com quem fez; inativar/reativar entram", async () => {
      dono();
      expect((await chamar("admin/empresas/[id]", "PATCH", { id: "eB" }, { ativo: false })).json).toEqual({ ok: true, ativo: false });
      expect((await chamar("admin/empresas/[id]", "PATCH", { id: "eB" }, { ativo: true })).json).toEqual({ ok: true, ativo: true });
      expect((await prisma.empresaEvento.findMany({ where: { empresaId: "eB" }, orderBy: { criadoEm: "asc" } })).map((e: any) => e.tipo)).toEqual(["INATIVADA", "REATIVADA"]);

      const g = await chamar("admin/empresas/[id]", "GET", { id: "eA" });
      expect(g.status).toBe(200);
      expect(g.json.empresa).toEqual({ razaoSocial: "Clima Aurora Serviços Ltda (fictícia)", nomeFantasia: null, cnpj: "11.444.777/0001-61", email: "novo@aurora.ficticio", telefone: "(11) 4000-0001" });
      expect(g.json.eventos.map((e: any) => e.tipo)).toEqual(["DADOS_EDITADOS", "NOVA_SENHA_ADMIN"]);
      expect(g.json.eventos.every((e: any) => e.autor === "Dono do Frivo")).toBe(true);
      // Nada de senha em lugar nenhum da resposta
      expect(JSON.stringify(g.json)).not.toMatch(/senha":/);
      expect((await chamar("admin/empresas/[id]", "GET", { id: "nao-existe" })).status).toBe(404);
    });
  });

  /* ───────────────────────── 3 ───────────────────────── */
  describe("3 — e-mail de login único no Frivo inteiro", () => {
    it("Configurações › Usuários: e-mail de usuário de OUTRA empresa (outra caixa) é recusado com a mensagem clara", async () => {
      como("ADMIN", "aSegundo", "eA");
      const r = await chamar("cadastros/[entidade]", "POST", { entidade: "usuarios" }, { nome: "Novo Usuário", email: "JOANA@boreal.ficticio", perfilAcessoId: "pOpA" });
      expect(r).toMatchObject({ status: 409, json: { erro: MSG_EMAIL_LOGIN_EM_USO } });
      expect(await prisma.usuario.count({ where: { email: { equals: "joana@boreal.ficticio", mode: "insensitive" } } })).toBe(1);
      const ok = await chamar("cadastros/[entidade]", "POST", { entidade: "usuarios" }, { nome: "Novo Usuário", email: "novo.usuario@aurora.ficticio", perfilAcessoId: "pOpA" });
      expect(ok.status).toBeLessThan(300);
    });

    it("acesso ao app do técnico: e-mail que é login em outra empresa → 409, nenhum login criado; o próprio login não conflita consigo", async () => {
      como("ADMIN", "aSegundo", "eA");
      await prisma.tecnico.createMany({ data: [
        { id: "tA", empresaId: "eA", nome: "Técnico Homônimo", cpf: "1", telefone: "1", email: "Joana@Boreal.Ficticio" },
        { id: "tA2", empresaId: "eA", nome: "Técnico Novo", cpf: "2", telefone: "2", email: "tecnico.novo@aurora.ficticio" },
      ] });
      const r = await chamar("tecnicos/[id]/acesso", "PUT", { id: "tA" }, { acessoAtivo: true, senha: "Inicial@2026x" });
      expect(r).toMatchObject({ status: 409, json: { erro: MSG_EMAIL_LOGIN_EM_USO } });
      expect(await prisma.usuario.count({ where: { empresaId: "eA", email: { equals: "joana@boreal.ficticio", mode: "insensitive" } } })).toBe(0);
      expect((await chamar("tecnicos/[id]/acesso", "PUT", { id: "tA2" }, { acessoAtivo: true, senha: "Inicial@2026x" })).json).toMatchObject({ temLogin: true, acessoAtivo: true });
      // De novo (redefinir a senha do login que já existe): ele mesmo não é "outro usuário"
      expect((await chamar("tecnicos/[id]/acesso", "PUT", { id: "tA2" }, { acessoAtivo: true, senha: "Outra@2026x" })).status).toBe(200);
    });

    it("ficha do colaborador: trocar para um e-mail que é login de outro usuário do Frivo → 409 e nada muda", async () => {
      como("ADMIN", "aSegundo", "eA");
      const corpo = (email: string) => ({ nome: "Técnico Novo", cpf: "529.982.247-25", telefone: "(11) 90000-0002", email, competenciaIds: [] });
      const r = await chamar("tecnicos/[id]", "PUT", { id: "tA2" }, corpo("joana@boreal.ficticio"));
      expect(r).toMatchObject({ status: 409, json: { erro: MSG_EMAIL_LOGIN_EM_USO } });
      expect((await prisma.tecnico.findUnique({ where: { id: "tA2" } })).email).toBe("tecnico.novo@aurora.ficticio");
      expect(await prisma.usuario.count({ where: { email: "tecnico.novo@aurora.ficticio" } })).toBe(1);
      // E-mail livre: a ficha e o login mudam juntos
      expect((await chamar("tecnicos/[id]", "PUT", { id: "tA2" }, corpo("tecnico.renomeado@aurora.ficticio"))).status).toBe(200);
      expect(await prisma.usuario.count({ where: { email: "tecnico.renomeado@aurora.ficticio" } })).toBe(1);
    });

    it("acesso ao portal: e-mail que já é acesso de contato de OUTRA empresa → 409; contato sem acesso e usuário do painel não conflitam", async () => {
      como("ADMIN", "aSegundo", "eA");
      const liberar = (contatoId: string, email: string) => chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "PUT", { id: "clA", contatoId }, { email, permissoes: { verOS: true } });
      const r = await liberar("ctA", "PORTAL@ficticio.test");
      expect(r).toMatchObject({ status: 409, json: { erro: MSG_EMAIL_PORTAL_EM_USO } });
      expect((await prisma.contatoCliente.findUnique({ where: { id: "ctA" } })).senha).toBeNull();
      // Contato sem acesso ao portal (só e-mail de contato) não é login: não conflita
      const sem = await liberar("ctA", "sem-acesso@ficticio.test");
      expect(sem.status).toBe(200);
      expect(sem.json.senhaProvisoria).toBeTruthy();
      // O próprio contato não conflita consigo (mudar as permissões com o mesmo e-mail)
      expect((await liberar("ctA", "SEM-ACESSO@ficticio.test")).status).toBe(200);
      // Usuário do painel e contato de portal são espaços separados (cada login procura só no seu)
      expect((await liberar("ctA", "joana@boreal.ficticio")).status).toBe(200);
    });

    it("gerar senha para quem ainda não tem acesso, e editar o e-mail de quem tem: também conferem", async () => {
      como("ADMIN", "aSegundo", "eA");
      // ctA2 (sem acesso) tem o e-mail do contato com portal da eB: gerar a senha liberaria um login duplicado
      expect(await chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "POST", { id: "clA", contatoId: "ctA2" })).toMatchObject({ status: 409, json: { erro: MSG_EMAIL_PORTAL_EM_USO } });
      expect((await prisma.contatoCliente.findUnique({ where: { id: "ctA2" } })).senha).toBeNull();
      // ctA tem acesso: trocar o e-mail (edição no contexto) para o de outro acesso → 409; o de um contato sem acesso, ok
      const editar = (contatoId: string, email: string) => chamar("clientes/[id]/contatos/[contatoId]", "PATCH", { id: "clA", contatoId }, { email });
      expect(await editar("ctA", "portal@ficticio.test")).toMatchObject({ status: 409, json: { erro: MSG_EMAIL_PORTAL_EM_USO } });
      expect((await prisma.contatoCliente.findUnique({ where: { id: "ctA" } })).email).toBe("joana@boreal.ficticio");
      // ctA2 não tem acesso: o e-mail é só de contato, pode repetir
      expect((await editar("ctA2", "portal@ficticio.test")).status).toBe(200);
    });

    it("Meu perfil: trocar para o e-mail de outro usuário do Frivo → 409 com a mensagem clara; o próprio e-mail em outra caixa não conflita", async () => {
      como("ADMIN", "aSegundo", "eA");
      const trocar = (email: string) => chamar("perfil", "PATCH", {}, { email, confirmacaoEmail: email, senhaAtual: SENHA_VELHA });
      expect(await trocar("joana@boreal.ficticio")).toMatchObject({ status: 409, json: { erro: MSG_EMAIL_LOGIN_EM_USO } });
      expect(await trocar("BEATRIZ@aurora.ficticio")).toMatchObject({ status: 409, json: { erro: MSG_EMAIL_LOGIN_EM_USO } });
      expect((await prisma.usuario.findUnique({ where: { id: "aSegundo" } })).email).toBe("carlos@aurora.ficticio");
      // Contato de portal com o mesmo e-mail não impede (outro espaço de login)
      expect((await trocar("portal@ficticio.test")).json).toMatchObject({ email: "portal@ficticio.test" });
      await prisma.usuario.update({ where: { id: "aSegundo" }, data: { email: "carlos@aurora.ficticio" } });
    });

    it("Nova empresa: o e-mail do 1º administrador já é login em outra empresa → 409 com a mensagem clara", async () => {
      dono();
      const r = await chamar("admin/empresas", "POST", {}, {
        razaoSocial: "Clima Austral Ltda (fictícia)", cnpj: "98.765.432/0001-98", email: "austral@ficticio.test",
        admin: { nome: "Admin Austral", email: "Carlos@Aurora.Ficticio", senha: "Austral@2027" },
      });
      expect(r).toMatchObject({ status: 409, json: { erro: MSG_EMAIL_LOGIN_EM_USO } });
    });
  });

  /* ───────────────────────── 4 ───────────────────────── */
  describe("4 — CSV contra fórmula, ida e volta", () => {
    it("exporta com o apóstrofo (texto que começa com = + - @); importa de volta pela Implantação e o valor é o original", async () => {
      // Nome e nome fantasia como o cadastro grava (a caixa padronizada de nomes, que a importação também aplica)
      const ORIGINAL = { nome: caixaNome('=HYPERLINK("http://golpe.ficticio";"clique")'), nomeFantasia: caixaNome("-5 graus"), observacoes: "@equipe ver amanhã", telefone: "+55 (11) 4000-0002", numero: "-5" };
      expect(ORIGINAL.nome.startsWith("=")).toBe(true);
      expect(ORIGINAL.nomeFantasia.startsWith("-5 ")).toBe(true);
      await prisma.cliente.update({ where: { id: "clA" }, data: ORIGINAL });
      como("ADMIN", "aSegundo", "eA");
      const mod = await import("@/app/api/configuracoes/exportar-dados/baixar/route");
      const res: Response = await mod.GET(new NextRequest("http://localhost/api/configuracoes/exportar-dados/baixar?parte=cadastros"));
      expect(res.status).toBe(200);
      const csv = abrirZip(new Uint8Array(await res.arrayBuffer()))["01-clientes.csv"];
      expect(csv).toContain(`"'${ORIGINAL.nome.replace(/"/g, '""')}"`);
      expect(csv).toContain(`;'${ORIGINAL.nomeFantasia};`);
      expect(csv).toContain(";'@equipe ver amanhã;");
      expect(csv).toContain(";'+55 (11) 4000-0002;");
      // Número (o nº do endereço "-5") não leva o apóstrofo
      expect(csv).toContain(";-5;");
      expect(csv).not.toContain("'-5;");

      // Alguém mexeu no cadastro; importar o backup de volta devolve o original (sem o apóstrofo)
      await prisma.cliente.update({ where: { id: "clA" }, data: { nome: "Trocado", nomeFantasia: "Trocado", observacoes: "Trocado", telefone: "0", numero: "0" } });
      const imp = await import("@/app/api/importacao/[entidade]/route");
      const fd = new FormData();
      fd.append("arquivo", new File([csv], "01-clientes.csv", { type: "text/csv" }));
      fd.append("etapa", "confirmar");
      const r: Response = await imp.POST(new NextRequest("http://localhost/x", { method: "POST", body: fd }), { params: Promise.resolve({ entidade: "clientes" }) });
      const j = await r.json();
      expect(r.status).toBe(200);
      expect(j).toMatchObject({ ok: true, atualizados: 1, criados: 0 });
      expect(await prisma.cliente.findUnique({ where: { id: "clA" }, select: { nome: true, nomeFantasia: true, observacoes: true, telefone: true, numero: true } })).toEqual(ORIGINAL);
    });
  });
});
