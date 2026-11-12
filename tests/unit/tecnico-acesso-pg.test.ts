/**
 * Acesso ao app do colaborador (Equipes › Colaboradores › Acesso ao app) — rotas reais com Prisma num
 * PostgreSQL real. Prova, de ponta a ponta, o que o usuário pediu:
 *  - liberar o acesso cria um usuário de LOGIN papel TECNICO (senha com hash), ligado ao colaborador
 *    pelo e-mail, da mesma empresa; e-mail de login único por empresa; redefinir e bloquear a senha;
 *  - esse técnico ENTRA e cai só nas OS DELE (Meu dia), e NÃO acessa o painel: a lista/detalhe de OS
 *    do painel dá 403, e o roteador do modo técnico manda qualquer tela do painel de volta ao app;
 *  - clientes, financeiro, estoque, orçamentos e configurações ficam fora do alcance dele (RBAC).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/tecnico-acesso-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, pode, montarPermissoes, type Permissoes } from "@/lib/permissoes";
import { emModoTecnico, destinoModoTecnico } from "@/lib/tecnico/modo";
import { inicioHojeBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_tecnico_acesso_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

/** Admin (gere usuários: Configurações › gerenciar). */
const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@clima.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };
/** Supervisor que gerencia colaboradores mas NÃO usuários (sem configuracoes.gerenciar). */
const comoSupervisor = () => { sessao.atual = { user: { id: "uS", name: "Sup", email: "sup@clima.com", empresaId: "e1", role: "OPERADOR", permissoes: montarPermissoes({ equipes: ["visualizar", "gerenciar"], ordens: ["visualizar"] }), tecnicoId: null } }; };
/** O técnico logado (papel TECNICO, perfil de Técnico), ligado ao técnico t1. */
const comoTecnico = (tecnicoId: string | null = "t1", email = "joao@clima.com", id = "uT1") => { sessao.atual = { user: { id, name: "João", email, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } }; };

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json() : null };
}
const acesso = (id: string, corpo: unknown) => chamar("tecnicos/[id]/acesso", "PUT", { id }, corpo);

describe.skipIf(!URL_PG)("Acesso ao app do colaborador + trava do papel TECNICO (PostgreSQL real)", () => {
  let prisma: any;
  const H = 60 * 60 * 1000;
  const hoje = inicioHojeBR();

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnicos/[id]/acesso", "tecnico/meu-dia", "ordens", "ordens/[id]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" } });
    await prisma.perfilAcesso.create({ data: { id: "pTec", empresaId: "e1", nome: "Técnico de Campo", tipo: "TECNICO", padraoSistema: true, permissoes: PRESETS.TECNICO as any } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@clima.com", senha: "x", role: "ADMIN" },
      { id: "uChefe", empresaId: "e1", nome: "Chefe", email: "chefe@clima.com", senha: "x", role: "GERENTE" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.com" },
      { id: "t2", empresaId: "e1", nome: "Maria Souza", cpf: "2", telefone: "2", email: "maria@clima.com" },
      { id: "t3", empresaId: "e1", nome: "Sem E-mail", cpf: "3", telefone: "3", email: null },
      { id: "t5", empresaId: "e1", nome: "Vira Painel", cpf: "5", telefone: "5", email: "chefe@clima.com" }, // e-mail de um usuário de painel
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "1", telefone: "1" },
      { id: "c2", empresaId: "e1", nome: "Padaria Pão Quente", cpfCnpj: "2" },
    ] });
    await prisma.ordemServico.createMany({ data: [
      { id: "osA", empresaId: "e1", numero: "OS-0001", clienteId: "c1", criadoPorId: "uA", descricao: "Preventiva do João" },
      { id: "osB", empresaId: "e1", numero: "OS-0002", clienteId: "c2", criadoPorId: "uA", descricao: "Corretiva da Maria" },
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "aA", empresaId: "e1", ordemServicoId: "osA", titulo: "Preventiva mensal", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 9 * H), status: "AGENDADA" },
      { id: "aB", empresaId: "e1", ordemServicoId: "osB", titulo: "Corretiva", tecnicoId: "t2", dataAgendada: new Date(hoje.getTime() + 10 * H), status: "AGENDADA" },
    ] });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("liberar o acesso cria o login papel TECNICO (senha com hash, perfil de técnico, ligado pelo e-mail)", async () => {
    // Gerenciar login exige Configurações › gerenciar: supervisor de colaboradores sozinho não pode.
    comoSupervisor();
    expect((await acesso("t1", { acessoAtivo: true, senha: "tecnico-123" })).status).toBe(403);

    comoAdmin();
    // Sem e-mail não dá para liberar (o e-mail é a identidade de login).
    expect((await acesso("t3", { acessoAtivo: true, senha: "tecnico-123" })).status).toBe(400);
    // Senha fraca é recusada.
    expect((await acesso("t1", { acessoAtivo: true, senha: "123" })).status).toBe(400);

    const r = await acesso("t1", { acessoAtivo: true, senha: "tecnico-123" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ temLogin: true, acessoAtivo: true, role: "TECNICO", email: "joao@clima.com" });

    const u = await prisma.usuario.findFirst({ where: { empresaId: "e1", email: "joao@clima.com" } });
    expect([u.role, u.ativo, u.perfilAcessoId, u.nome]).toEqual(["TECNICO", true, "pTec", "João Silva"]);
    expect(await bcrypt.compare("tecnico-123", u.senha)).toBe(true); // entra com a senha definida

    // Ligado ao colaborador pelo e-mail (sem coluna nova).
    const { tecnicoDoUsuario } = await import("@/lib/tecnico/escopo");
    expect(await tecnicoDoUsuario("e1", "joao@clima.com")).toMatchObject({ id: "t1" });
  });

  it("e-mail de login único por empresa; e não sequestra uma conta de painel", async () => {
    comoAdmin();
    // Outro colaborador ATIVO com o mesmo e-mail do t1 (já liberado): vínculo ambíguo → 409.
    await prisma.tecnico.create({ data: { id: "t4", empresaId: "e1", nome: "Homônimo", cpf: "4", telefone: "4", email: "joao@clima.com" } });
    expect((await acesso("t4", { acessoAtivo: true, senha: "outra-senha-1" })).status).toBe(409);
    await prisma.tecnico.delete({ where: { id: "t4" } });
    // E-mail que já é de um usuário de PAINEL (GERENTE): não vira login de técnico → 409.
    const r = await acesso("t5", { acessoAtivo: true, senha: "outra-senha-1" });
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/painel/i);
  });

  it("o técnico ENTRA e cai só nas OS DELE (Meu dia); não vê as de outro técnico", async () => {
    comoTecnico("t1");
    const meu = await chamar("tecnico/meu-dia", "GET");
    expect(meu.status).toBe(200);
    expect(meu.json.tecnico).toMatchObject({ id: "t1" });
    expect(meu.json.atividades.map((a: any) => a.atividadeId)).toEqual(["aA"]); // só a dele, não "aB"

    comoTecnico("t2", "maria@clima.com", "uT2");
    expect((await chamar("tecnico/meu-dia", "GET")).json.atividades.map((a: any) => a.atividadeId)).toEqual(["aB"]);
  });

  it("o painel fica TRAVADO para o técnico: lista/detalhe de OS dão 403; telas do painel voltam ao app; gestão fora do alcance (RBAC)", async () => {
    comoTecnico("t1");
    // APIs do painel de OS: 403 (o app usa /api/tecnico/*; estas são do painel).
    expect((await chamar("ordens", "GET")).status).toBe(403);
    expect((await chamar("ordens/[id]", "GET", { id: "osB" })).status).toBe(403);

    // A trava é do modo técnico: o escritório (admin) segue vendo a lista do painel.
    comoAdmin();
    expect((await chamar("ordens", "GET")).status).toBe(200);

    // Regras puras (as mesmas que o middleware roda): papel TECNICO está no app e o painel o manda de volta.
    const tec = { role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" };
    expect(emModoTecnico(tec)).toBe(true);
    expect(destinoModoTecnico("/clientes")).toBe("/tecnico?aviso=restrito");
    expect(destinoModoTecnico("/financeiro/contas-receber")).toBe("/tecnico?aviso=restrito");
    expect(destinoModoTecnico("/configuracoes")).toBe("/tecnico?aviso=restrito");
    expect(destinoModoTecnico("/tecnico")).toBeNull(); // o app em si é liberado

    // E o RBAC do perfil de técnico nega os módulos de gestão, mesmo pela URL/menu.
    for (const m of ["clientes", "financeiro", "estoque", "orcamentos", "configuracoes"]) {
      expect(pode(PRESETS.TECNICO, m, "visualizar", "TECNICO")).toBe(false);
    }
    // O que ele PODE: as próprias OS (pelo app) e o essencial do campo.
    for (const m of ["ordens", "equipamentos", "calendario", "qrcodes"]) {
      expect(pode(PRESETS.TECNICO, m, "visualizar", "TECNICO")).toBe(true);
    }
  });

  it("redefinir a senha troca o hash; bloquear o acesso inativa o login (sem apagar o colaborador); reativar reaproveita", async () => {
    comoAdmin();
    // Redefinir senha.
    expect((await acesso("t1", { acessoAtivo: true, senha: "nova-senha-9" })).status).toBe(200);
    let u = await prisma.usuario.findFirst({ where: { empresaId: "e1", email: "joao@clima.com" } });
    expect(await bcrypt.compare("nova-senha-9", u.senha)).toBe(true);
    expect(await bcrypt.compare("tecnico-123", u.senha)).toBe(false);

    // Bloquear: inativa o login (o authorize do NextAuth só entra com ativo:true) — colaborador intacto.
    expect((await acesso("t1", { acessoAtivo: false })).json).toMatchObject({ temLogin: true, acessoAtivo: false });
    u = await prisma.usuario.findFirst({ where: { empresaId: "e1", email: "joao@clima.com" } });
    expect(u.ativo).toBe(false);
    expect(await prisma.tecnico.findFirst({ where: { id: "t1" } })).toMatchObject({ ativo: true, email: "joao@clima.com" });

    // Reativar sem senha: reaproveita o login (não precisa redefinir).
    expect((await acesso("t1", { acessoAtivo: true })).json).toMatchObject({ acessoAtivo: true });
    expect((await prisma.usuario.findFirst({ where: { empresaId: "e1", email: "joao@clima.com" } })).ativo).toBe(true);
    // A senha segue a última definida.
    u = await prisma.usuario.findFirst({ where: { empresaId: "e1", email: "joao@clima.com" } });
    expect(await bcrypt.compare("nova-senha-9", u.senha)).toBe(true);
  });
});
