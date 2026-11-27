/**
 * "Troca de senha no 1º acesso", de ponta a ponta com o Auth.js REAL (login pelo mesmo POST do formulário),
 * o middleware real, a rota real da troca e o banco em memória:
 *  - a regra pura: com a troca pendente só abrem a tela de troca e a rota da troca (página → tela de troca;
 *    API → 403 com a mensagem); sem a marca, nada muda;
 *  - quem tem `trocar_senha` entra (login normal) e o token leva a marca; o middleware o leva à tela de
 *    troca em qualquer página (painel e app do técnico) e recusa as APIs;
 *  - a troca pela própria pessoa (senha recebida + nova) limpa a marca no cadastro e no cookie desta sessão:
 *    a partir daí o sistema abre normalmente;
 *  - definir a senha pelo link (convite / "Esqueci minha senha") também limpa a marca;
 *  - quem não tem a marca nunca vê a tela de troca.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { decode, encode } from "next-auth/jwt";
import type { Banco } from "./helpers/banco-memoria";
import { PRESETS } from "@/lib/permissoes";
import { API_TROCAR_SENHA, MENSAGEM_TROCA_PENDENTE, ROTA_TROCAR_SENHA, decisaoDaTroca, trocaPendente } from "@/lib/acesso/troca-obrigatoria";

const SEGREDO = "segredo-de-teste-troca-senha-com-32-caracteres!";
process.env.AUTH_SECRET = SEGREDO;
process.env.AUTH_URL = "http://localhost/api/auth";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  return { prisma: criarPrisma(db, { usuario: (r, T) => ({ empresa: T("empresa").find((e) => e.id === r.empresaId), perfilAcesso: null }) }) };
});
// `auth()` das rotas (sem contexto de requisição no teste); o resto do Auth.js é o real
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 30_000 });

const COOKIE = "authjs.session-token";
const SENHA_RECEBIDA = "Recebida-123";
let handlers: typeof import("@/lib/auth").handlers;
let middleware: (req: NextRequest, ev: unknown) => Promise<Response>;
let HASH = "";

beforeAll(async () => {
  ({ handlers } = await import("@/lib/auth"));
  middleware = (await import("@/middleware")).default as never;
  HASH = await bcrypt.hash(SENHA_RECEBIDA, 4);
}, 30_000);

const errorOriginal = console.error;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    const t = String(a[0]);
    if ((t.includes("[auth][error]") && /CredentialsSignin|JWTSessionError/.test(t)) || /\[auth\]\[(cause|details)\]/.test(t)) return;
    errorOriginal(...a);
  });
  sessao.atual = null;
  db.escritas = [];
  db.t = {
    empresa: [{ id: "e1", nomeFantasia: "Refrigeração Fictícia", ativo: true }],
    usuario: [
      // o 1º admin criado em Empresas: senha do super admin, marcada para troca
      { id: "u1", empresaId: "e1", nome: "Beatriz Fictícia", email: "beatriz@ficticio.test", senha: HASH, ativo: true, role: "ADMIN", perfilAcessoId: null, trocarSenha: true },
      // quem já trocou (ou definiu pelo convite): nada muda
      { id: "u2", empresaId: "e1", nome: "Caio Fictício", email: "caio@ficticio.test", senha: HASH, ativo: true, role: "OPERADOR", perfilAcessoId: null, trocarSenha: false },
    ],
    tentativaAcesso: [],
    tecnico: [],
  };
});
afterEach(() => { vi.restoreAllMocks(); });

const usuario = (id: string) => (db.t as any).usuario.find((u: any) => u.id === id);

/** O que o formulário de login faz: csrf → credenciais. */
async function entrar(email: string, senha: string) {
  const c = await handlers.GET(new NextRequest("http://localhost/api/auth/csrf"));
  const { csrfToken } = await c.json();
  const cookieCsrf = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const res = await handlers.POST(new NextRequest("http://localhost/api/auth/callback/credentials", {
    method: "POST", body: new URLSearchParams({ email, senha, csrfToken, callbackUrl: "http://localhost/dashboard" }),
    headers: { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1", cookie: cookieCsrf, "x-forwarded-for": "200.1.1.9" },
  }));
  const url = new URL((await res.json()).url);
  const linha = res.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE}=`)) ?? "";
  return { ok: !url.searchParams.get("error"), cookie: linha.split(";")[0] };
}
const lerToken = async (cookie: string) => decode({ token: cookie.slice(COOKIE.length + 1), secret: SEGREDO, salt: COOKIE });
async function abrir(caminho: string, cookie: string, metodo = "GET") {
  const res = await middleware(new NextRequest(`http://localhost${caminho}`, { method: metodo, headers: { cookie } }), {});
  return { status: res.status, destino: res.headers.get("location"), json: res.headers.get("content-type")?.includes("json") ? await res.json() : null };
}
async function trocar(cookie: string, corpo: Record<string, string>) {
  const { PATCH } = await import("@/app/api/perfil/senha/route");
  const res = await PATCH(new NextRequest(`http://localhost${API_TROCAR_SENHA}`, { method: "PATCH", body: JSON.stringify(corpo), headers: { "content-type": "application/json", cookie } }));
  const linha = res.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE}=`)) ?? "";
  return { status: res.status, json: await res.json(), cookie: linha.split(";")[0] };
}

describe("a regra (pura)", () => {
  const pendente = { trocarSenha: true };
  it("sem a marca, nada muda", () => {
    for (const u of [null, undefined, {}, { trocarSenha: false }, { trocarSenha: "true" }]) {
      expect(trocaPendente(u)).toBe(false);
      expect(decisaoDaTroca("/dashboard", u)).toBeNull();
      expect(decisaoDaTroca("/api/clientes", u)).toBeNull();
    }
  });
  it("com a marca: página → tela de troca; API → 403; a tela e a rota da troca abrem", () => {
    expect(trocaPendente(pendente)).toBe(true);
    for (const p of ["/dashboard", "/tecnico", "/tecnico/agenda", "/perfil", "/configuracoes", "/trocar-senhas"]) {
      expect(decisaoDaTroca(p, pendente), p).toEqual({ tipo: "pagina", destino: ROTA_TROCAR_SENHA });
    }
    for (const p of ["/api/clientes", "/api/perfil", "/api/perfil/senhas", "/api/tecnico/sync", "/api"]) {
      expect(decisaoDaTroca(p, pendente), p).toEqual({ tipo: "api" });
    }
    for (const p of [ROTA_TROCAR_SENHA, API_TROCAR_SENHA, "/sessao-encerrada"]) expect(decisaoDaTroca(p, pendente), p).toBeNull();
  });
});

describe("de ponta a ponta: login → só a troca → trocou → sistema liberado", () => {
  it("o login leva a marca no token; o middleware leva qualquer página à tela de troca e recusa as APIs", async () => {
    const { ok, cookie } = await entrar("beatriz@ficticio.test", SENHA_RECEBIDA);
    expect(ok).toBe(true);
    expect(await lerToken(cookie)).toMatchObject({ id: "u1", trocarSenha: true });
    // a sessão também diz (a tela de troca e o layout leem daqui)
    const s = await handlers.GET(new NextRequest("http://localhost/api/auth/session", { headers: { cookie } }));
    expect((await s.json()).user.trocarSenha).toBe(true);

    for (const p of ["/dashboard", "/clientes", "/configuracoes?aba=conta", "/", "/login"]) {
      const r = await abrir(p, cookie);
      // "/" e "/login" passam pelo /dashboard e de lá vão à troca
      const fim = r.destino && new URL(r.destino).pathname === "/dashboard" ? await abrir("/dashboard", cookie) : r;
      expect(new URL(fim.destino!).pathname, p).toBe(ROTA_TROCAR_SENHA);
    }
    const api = await abrir("/api/clientes", cookie);
    expect([api.status, api.json]).toEqual([403, { erro: MENSAGEM_TROCA_PENDENTE }]);
    expect((await abrir("/api/os", cookie, "POST")).status).toBe(403);
    // a tela e a rota da troca abrem
    expect((await abrir(ROTA_TROCAR_SENHA, cookie)).destino).toBeNull();
    expect((await abrir(API_TROCAR_SENHA, cookie, "PATCH")).status).toBe(200);
  });

  it("a troca pela própria pessoa limpa a marca (cadastro e cookie desta sessão) e libera o sistema", async () => {
    const { cookie } = await entrar("beatriz@ficticio.test", SENHA_RECEBIDA);
    sessao.atual = { user: { id: "u1", empresaId: "e1", role: "ADMIN", permissoes: {}, trocarSenha: true } };
    // senha recebida errada: nada muda
    expect((await trocar(cookie, { senhaAtual: "Errada-123", novaSenha: "Minha-senha9", confirmar: "Minha-senha9" })).status).toBe(400);
    expect(usuario("u1").trocarSenha).toBe(true);
    // a nova igual à recebida: recusada
    expect((await trocar(cookie, { senhaAtual: SENHA_RECEBIDA, novaSenha: SENHA_RECEBIDA, confirmar: SENHA_RECEBIDA })).status).toBe(400);
    expect(usuario("u1").trocarSenha).toBe(true);

    const r = await trocar(cookie, { senhaAtual: SENHA_RECEBIDA, novaSenha: "Minha-senha9", confirmar: "Minha-senha9" });
    expect(r.status).toBe(200);
    expect(usuario("u1").trocarSenha).toBe(false);
    expect(await bcrypt.compare("Minha-senha9", usuario("u1").senha)).toBe(true);
    // o cookie desta sessão volta sem a marca (e com a impressão da senha nova): o sistema abre
    expect(await lerToken(r.cookie)).toMatchObject({ id: "u1", trocarSenha: false });
    expect((await abrir("/dashboard", r.cookie)).destino).toBeNull();
    expect((await abrir("/api/clientes", r.cookie)).status).not.toBe(403);
    // o cookie antigo (outra aba/aparelho com a senha recebida) deixou de valer
    const s = await handlers.GET(new NextRequest("http://localhost/api/auth/session", { headers: { cookie } }));
    expect(await s.json()).toBeNull();
    // e o próximo login entra direto
    const de = await entrar("beatriz@ficticio.test", "Minha-senha9");
    expect(await lerToken(de.cookie)).toMatchObject({ trocarSenha: false });
  });

  it("quem não tem a marca nunca vê a troca", async () => {
    const { cookie } = await entrar("caio@ficticio.test", SENHA_RECEBIDA);
    expect(await lerToken(cookie)).toMatchObject({ id: "u2", trocarSenha: false });
    expect((await abrir("/dashboard", cookie)).destino).toBeNull();
    expect((await abrir("/api/clientes", cookie)).status).not.toBe(403);
  });

  it("a sessão segue o cadastro: marca limpa no banco (por outro caminho) não prende ninguém na troca", async () => {
    const { cookie } = await entrar("beatriz@ficticio.test", SENHA_RECEBIDA);
    usuario("u1").trocarSenha = false;
    const s = await handlers.GET(new NextRequest("http://localhost/api/auth/session", { headers: { cookie } }));
    expect((await s.json()).user.trocarSenha).toBe(false);
  });
});

describe("app do técnico", () => {
  it("o técnico com a troca pendente também vai à tela de troca, e não ao app", async () => {
    const cookie = `${COOKIE}=${await encode({
      salt: COOKIE, secret: SEGREDO,
      token: { sub: "uT", id: "uT", name: "Diego", email: "diego@ficticio.test", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1", lembrar: true, loginEm: Date.now(), trocarSenha: true },
    })}`;
    for (const p of ["/tecnico", "/tecnico/agenda", "/dashboard"]) expect(new URL((await abrir(p, cookie)).destino!).pathname, p).toBe(ROTA_TROCAR_SENHA);
    expect((await abrir("/api/tecnico/sync", cookie, "POST")).status).toBe(403);
    expect((await abrir(ROTA_TROCAR_SENHA, cookie)).destino).toBeNull();
  });
});

describe("definir a senha pelo link (convite / Esqueci minha senha) também conta como troca", () => {
  it("limpa a marca", async () => {
    const { gerarTokenSenha, definirSenhaPorConvite } = await import("@/lib/usuarios/convite");
    const token = gerarTokenSenha(usuario("u1"), "recuperacao");
    const r = await definirSenhaPorConvite(token, "Pelo-link-77");
    expect((r as any).ok ?? (r as any).erro ?? r).not.toBeUndefined();
    expect(usuario("u1").trocarSenha).toBe(false);
    expect(await bcrypt.compare("Pelo-link-77", usuario("u1").senha)).toBe(true);
  });
});
