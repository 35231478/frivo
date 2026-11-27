/**
 * Portal do cliente: senha provisória segura — DE PONTA A PONTA, com o Auth.js do portal real (login pelo
 * mesmo POST do formulário), as rotas, páginas e o guarda reais e o PostgreSQL real:
 *  - a equipe libera o acesso: o SISTEMA gera a senha (a digitada é ignorada), mostra UMA vez, grava só o
 *    hash e marca a troca; a lista de contatos nunca devolve senha; salvar de novo não mostra senha;
 *  - o contato entra com a provisória e SÓ a troca abre: qualquer página do portal leva à tela de troca, a
 *    API recusa (403) e a sessão "comum" não existe (QR, aceite) — sem ciclo: a tela de troca não volta ao
 *    login nem ao painel;
 *  - a troca: senha recebida errada não muda nada (e tem limite), a nova segue a regra e precisa ser
 *    diferente; deu certo, a marca sai, o cookie volta regravado e o portal abre; a sessão antiga (senha
 *    provisória) cai e cai no login, sem ciclo;
 *  - "Gerar nova senha provisória" volta a pedir a troca; "Esqueci minha senha" também limpa a marca;
 *  - quem já tinha acesso (hash atual, sem a marca) continua entrando direto; a senha em texto antiga
 *    (coluna obsoleta) não aparece em lugar nenhum;
 *  - o limite de tentativas do login do portal é o mesmo do painel (e o painel não muda).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/portal-senha-provisoria-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_portal_senha_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
process.env.AUTH_SECRET = "segredo-de-teste-portal-senha-com-32-caracteres!";

// Sessão do PAINEL (rotas da equipe): mock simples. O portal é o Auth.js real, lendo o cookie do "navegador".
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// O "navegador": o cookie que as páginas e rotas do portal recebem (next/headers fora de uma requisição real)
const navegador = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: navegador.cookie }),
  cookies: async () => {
    const lista = navegador.cookie.split("; ").filter(Boolean).map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1) }));
    return { get: (n: string) => lista.find((c) => c.name === n), getAll: () => lista, has: (n: string) => lista.some((c) => c.name === n) };
  },
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, children, ...rest }: any) => React.createElement("a", { href: String(href), ...rest }, children) };
});
vi.setConfig({ testTimeout: 60_000 });

const COOKIE = "frivo.portal-session-token";
const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };
let portalHandlers: typeof import("@/lib/auth-portal").portalHandlers;

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json", cookie: navegador.cookie }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, headers: res.headers, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
/** O que o formulário do portal faz: csrf → credenciais. */
async function entrar(email: string, senha: string, ip = "200.2.2.2") {
  const c = await portalHandlers.GET(new NextRequest("http://localhost/api/portal-auth/csrf"));
  const { csrfToken } = await c.json();
  const cookieCsrf = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const res = await portalHandlers.POST(new NextRequest("http://localhost/api/portal-auth/callback/credentials", {
    method: "POST", body: new URLSearchParams({ email, senha, csrfToken, callbackUrl: "http://localhost/portal/dashboard" }),
    headers: { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1", cookie: cookieCsrf, "x-forwarded-for": ip },
  }));
  const url = new URL((await res.json()).url);
  const linha = res.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE}=`)) ?? "";
  return { ok: !url.searchParams.get("error"), code: url.searchParams.get("code"), cookie: linha.split(";")[0] };
}
const sessaoDoCookie = async (cookie: string) => (await portalHandlers.GET(new NextRequest("http://localhost/api/portal-auth/session", { headers: { cookie } }))).json();
/** Abre uma página/guarda do portal com o cookie: devolve para onde redirecionou (ou null = abriu). */
async function abrir(fn: () => Promise<unknown>, cookie: string): Promise<string | null> {
  navegador.cookie = cookie;
  try { await fn(); return null; } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_REDIRECT")) return d.split(";")[2];
    throw e;
  }
}
const pagina = (caminho: string) => async () => (await import(/* @vite-ignore */ `@/app/(portal)/portal/${caminho}/page`)).default({ searchParams: Promise.resolve({}) });
const trocar = async (cookie: string, corpo: Record<string, string>) => { navegador.cookie = cookie; return chamar("portal/senha", "PATCH", {}, corpo); };

const errorOriginal = console.error;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    const t = String(a[0]);
    if ((t.includes("[auth][error]") && /CredentialsSignin|JWTSessionError|CallbackRouteError/.test(t)) || (/^\s+at /.test(t) && t.includes("@auth/core")) || /\[auth\]\[(cause|details)\]/.test(t)) return;
    errorOriginal(...a);
  });
  navegador.cookie = "";
});

describe.skipIf(!URL_PG)("portal: senha provisória segura e troca no 1º acesso (PostgreSQL real, ponta a ponta)", () => {
  let prisma: any;
  let senhaProvisoria = "";
  let cookieProvisorio = "";
  let cookieNovo = "";
  const NOVA = "MinhaSenha2027";
  const contato = async (id = "ct1") => prisma.contatoCliente.findUnique({ where: { id } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ portalHandlers } = await import("@/lib/auth-portal"));
    await prisma.empresa.create({ data: { id: "e1", nome: "Polar Clima Fictícia", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Clínica Exemplo", cpfCnpj: "11.111.111/0001-11" } });
    await prisma.contatoCliente.createMany({ data: [
      { id: "ct1", empresaId: "e1", clienteId: "c1", nome: "Paula Fictícia", email: "paula@clinica.test" },
      // acesso ANTIGO: hash atual, sem a marca, e a senha em texto que a coluna obsoleta guardava
      { id: "ct2", empresaId: "e1", clienteId: "c1", nome: "Rui Antigo", email: "rui@clinica.test", senha: await bcrypt.hash("Antiga-2026", 4), senhaProvisoria: "Antiga-2026", permissoes: { verOS: true } },
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("liberar o acesso: o sistema gera a senha, mostra UMA vez, grava só o hash e marca a troca", async () => {
    comoAdmin();
    const r = await chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "PUT", { id: "c1", contatoId: "ct1" },
      { email: "paula@clinica.test", senha: "DigitadaPelaEquipe1", ativo: true, permissoes: { verOS: true, abrirChamados: true } });
    expect(r.status).toBe(200);
    senhaProvisoria = r.json.senhaProvisoria;
    expect(senhaProvisoria).toMatch(/^[A-Za-z0-9]{12}$/);
    const c = await contato();
    expect(c.senhaProvisoria).toBeNull();
    expect(c.trocarSenha).toBe(true);
    expect(await bcrypt.compare(senhaProvisoria, c.senha)).toBe(true);
    expect(await bcrypt.compare("DigitadaPelaEquipe1", c.senha)).toBe(false);
    // Salvar de novo (permissões): a senha não aparece mais
    const outra = await chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "PUT", { id: "c1", contatoId: "ct1" },
      { email: "paula@clinica.test", ativo: true, permissoes: { verOS: true, abrirChamados: true, verDocumentos: true } });
    expect(outra.json.senhaProvisoria).toBeNull();
    expect(await bcrypt.compare(senhaProvisoria, (await contato()).senha)).toBe(true); // a senha não mudou
    // A lista de contatos nunca devolve senha (nem hash, nem o texto antigo)
    const lista = await chamar("clientes/[id]/contatos", "GET", { id: "c1" });
    const txt = JSON.stringify(lista.json);
    expect(txt).not.toContain(senhaProvisoria);
    expect(txt).not.toContain("Antiga-2026");
    expect(txt).not.toContain("$2");
  });

  it("entrou com a provisória: SÓ a troca abre (páginas → troca; API → 403; sessão comum não existe), sem ciclo", async () => {
    const login = await entrar("paula@clinica.test", senhaProvisoria);
    expect(login.ok).toBe(true);
    cookieProvisorio = login.cookie;
    expect((await sessaoDoCookie(cookieProvisorio)).user.trocarSenha).toBe(true);
    for (const p of ["dashboard", "chamados", "documentos", "financeiro"]) {
      expect(await abrir(pagina(`(protegido)/${p}`), cookieProvisorio), p).toBe("/portal/trocar-senha");
    }
    expect(await abrir(pagina("login"), cookieProvisorio)).toBe("/portal/trocar-senha");
    expect(await abrir(pagina("trocar-senha"), cookieProvisorio)).toBeNull(); // a tela abre: não volta a lugar nenhum
    navegador.cookie = cookieProvisorio;
    const { getPortalSession } = await import("@/lib/auth-portal");
    expect(await getPortalSession()).toBeNull(); // QR, aceite e o resto tratam como não logado
    expect((await getPortalSession({ comTroca: true }))?.user.trocarSenha).toBe(true);
    const chamado = await chamar("portal/chamados", "POST", {}, { titulo: "Teste", descricao: "Ar não gela", urgencia: "NORMAL" });
    expect(chamado.status).toBe(403);
    expect(chamado.json.erro).toBe("Crie a sua senha para continuar.");
    expect(await prisma.ordemServico.count()).toBe(0);
  });

  it("a troca recusa: senha recebida errada (sem mudar nada), nova fraca, nova igual à recebida e confirmação diferente", async () => {
    const antes = (await contato()).senha;
    const errada = await trocar(cookieProvisorio, { senhaAtual: "errada-123", novaSenha: NOVA, confirmar: NOVA });
    expect([errada.status, errada.json.erro]).toEqual([400, "Senha recebida incorreta."]);
    const fraca = await trocar(cookieProvisorio, { senhaAtual: senhaProvisoria, novaSenha: "abc", confirmar: "abc" });
    expect(fraca.status).toBe(400);
    const igual = await trocar(cookieProvisorio, { senhaAtual: senhaProvisoria, novaSenha: senhaProvisoria, confirmar: senhaProvisoria });
    expect([igual.status, igual.json.erro]).toEqual([400, "A nova senha precisa ser diferente da recebida."]);
    const conf = await trocar(cookieProvisorio, { senhaAtual: senhaProvisoria, novaSenha: NOVA, confirmar: `${NOVA}x` });
    expect(conf.status).toBe(400);
    const c = await contato();
    expect([c.senha, c.trocarSenha]).toEqual([antes, true]);
    const semSessao = await trocar("", { senhaAtual: senhaProvisoria, novaSenha: NOVA, confirmar: NOVA });
    expect(semSessao.status).toBe(401);
  });

  it("trocou: a marca sai, o cookie volta regravado (atributos certos) e o portal abre; a sessão da provisória cai no login, sem ciclo", async () => {
    const r = await trocar(cookieProvisorio, { senhaAtual: senhaProvisoria, novaSenha: NOVA, confirmar: NOVA });
    expect(r.status).toBe(200);
    const linha = r.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE}=`))!;
    expect(linha).toMatch(/HttpOnly/i);
    expect(linha).toMatch(/SameSite=Lax/i);
    expect(linha).toMatch(/Path=\//);
    cookieNovo = linha.split(";")[0];
    const c = await contato();
    expect(c.trocarSenha).toBe(false);
    expect(await bcrypt.compare(NOVA, c.senha)).toBe(true);
    // Portal liberado com o cookie novo
    expect((await sessaoDoCookie(cookieNovo)).user.trocarSenha).toBe(false);
    expect(await abrir(pagina("(protegido)/dashboard"), cookieNovo)).toBeNull();
    expect(await abrir(pagina("trocar-senha"), cookieNovo)).toBe("/portal/dashboard");
    expect(await abrir(pagina("login"), cookieNovo)).toBe("/portal/dashboard");
    // A sessão aberta com a provisória caiu: vai ao login, e o login ABRE (não manda de volta)
    expect(await sessaoDoCookie(cookieProvisorio)).toBeNull();
    expect(await abrir(pagina("(protegido)/dashboard"), cookieProvisorio)).toBe("/portal/login");
    expect(await abrir(pagina("login"), cookieProvisorio)).toBeNull();
    expect(await abrir(pagina("trocar-senha"), cookieProvisorio)).toBe("/portal/login");
    // A provisória não entra mais; a nova entra direto, sem troca
    expect((await entrar("paula@clinica.test", senhaProvisoria)).ok).toBe(false);
    const ok = await entrar("paula@clinica.test", NOVA);
    expect(ok.ok).toBe(true);
    expect(await abrir(pagina("(protegido)/dashboard"), ok.cookie)).toBeNull();
  });

  it("'Gerar nova senha provisória' volta a pedir a troca e derruba as sessões abertas", async () => {
    comoAdmin();
    const r = await chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "POST", { id: "c1", contatoId: "ct1" });
    expect(r.json.senhaProvisoria).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await contato()).trocarSenha).toBe(true);
    expect(await sessaoDoCookie(cookieNovo)).toBeNull();
    const login = await entrar("paula@clinica.test", r.json.senhaProvisoria);
    expect(await abrir(pagina("(protegido)/dashboard"), login.cookie)).toBe("/portal/trocar-senha");
    senhaProvisoria = r.json.senhaProvisoria;
  });

  it("'Esqueci minha senha' também conta como troca: limpa a marca", async () => {
    const { gerarTokenSenhaPortal, definirSenhaPortal } = await import("@/lib/portal/recuperacao");
    const c = await contato();
    const v = await definirSenhaPortal(gerarTokenSenhaPortal({ id: c.id, senha: c.senha }), "PeloLink2027");
    expect(v.ok).toBe(true);
    const depois = await contato();
    expect(depois.trocarSenha).toBe(false);
    const login = await entrar("paula@clinica.test", "PeloLink2027");
    expect(await abrir(pagina("(protegido)/dashboard"), login.cookie)).toBeNull();
  });

  it("acesso antigo (hash atual, sem a marca): continua entrando direto; revogar zera tudo", async () => {
    const login = await entrar("rui@clinica.test", "Antiga-2026");
    expect(login.ok).toBe(true);
    expect(await abrir(pagina("(protegido)/dashboard"), login.cookie)).toBeNull();
    comoAdmin();
    await chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "DELETE", { id: "c1", contatoId: "ct2" });
    const c = await contato("ct2");
    expect([c.senha, c.senhaProvisoria, c.trocarSenha]).toEqual([null, null, false]);
    expect(await abrir(pagina("(protegido)/dashboard"), login.cookie)).toBe("/portal/login");
  });

  it("limite de tentativas: login do portal (5 por e-mail, igual ao painel) e troca com a senha recebida errada (5)", async () => {
    comoAdmin();
    const r = await chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "POST", { id: "c1", contatoId: "ct1" });
    for (let i = 0; i < 5; i++) expect((await entrar("paula@clinica.test", "errada-123", `200.9.9.${i}`)).ok).toBe(false);
    const bloqueado = await entrar("paula@clinica.test", r.json.senhaProvisoria, "200.9.9.99");
    expect(bloqueado.ok).toBe(false);
    expect(bloqueado.code).toMatch(/^bloqueado-\d+$/);
    await prisma.tentativaAcesso.deleteMany({});
    const login = await entrar("paula@clinica.test", r.json.senhaProvisoria);
    expect(login.ok).toBe(true);
    for (let i = 0; i < 5; i++) expect((await trocar(login.cookie, { senhaAtual: "errada-123", novaSenha: NOVA, confirmar: NOVA })).status).toBe(400);
    const travada = await trocar(login.cookie, { senhaAtual: r.json.senhaProvisoria, novaSenha: NOVA, confirmar: NOVA });
    expect(travada.status).toBe(429);
    expect((await contato()).trocarSenha).toBe(true);
  });
});
