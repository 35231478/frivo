/**
 * Leva 0, item 5 — a sessão (JWT) confere no banco se o usuário e a empresa seguem ativos.
 * Usa o Auth.js REAL (lib/auth.ts): monta um cookie de sessão assinado e lê /api/auth/session,
 * que passa pelo mesmo callback `jwt` usado por `auth()` nas páginas e APIs. Banco em memória.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import type { Banco } from "./helpers/banco-memoria";

const SEGREDO = "segredo-de-teste-leva0-com-32-caracteres!";
process.env.AUTH_SECRET = SEGREDO;
process.env.AUTH_URL = "http://localhost/api/auth";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
const falhar = vi.hoisted(() => ({ banco: false }));
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const base = criarPrisma(db, { usuario: (r, T) => ({ empresa: T("empresa").find((e) => e.id === r.empresaId) }) });
  return {
    prisma: new Proxy(base, {
      get: (t, m: string) => (m === "usuario" && falhar.banco ? { findUnique: async () => { throw new Error("banco fora"); } } : t[m]),
    }),
  };
});

const COOKIE = "authjs.session-token";
let handlers: typeof import("@/lib/auth").handlers;
beforeAll(async () => { ({ handlers } = await import("@/lib/auth")); });

beforeEach(() => {
  falhar.banco = false;
  db.t = {
    empresa: [{ id: "e1", ativo: true }],
    usuario: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "ana@x.com", ativo: true, role: "OPERADOR" }],
  };
});

async function cookieDeSessao() {
  const token = await encode({
    salt: COOKIE, secret: SEGREDO,
    token: { sub: "u1", id: "u1", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "OPERADOR", permissoes: {} },
  });
  return `${COOKIE}=${token}`;
}

/** Uma "requisição" do usuário: lê a sessão como `auth()` faz. */
async function lerSessao(cookie: string) {
  const res = await handlers.GET(new NextRequest("http://localhost/api/auth/session", { headers: { cookie } }));
  return { sessao: await res.json(), setCookie: res.headers.get("set-cookie") ?? "" };
}

describe("sessão de usuário inativado", () => {
  it("usuário ativo: a sessão vale", async () => {
    const { sessao } = await lerSessao(await cookieDeSessao());
    expect(sessao?.user).toMatchObject({ id: "u1", empresaId: "e1" });
  });

  it("usuário inativado perde o acesso na requisição seguinte (e o cookie é apagado)", async () => {
    const cookie = await cookieDeSessao();
    expect((await lerSessao(cookie)).sessao?.user?.id).toBe("u1");

    db.t.usuario[0].ativo = false; // inativado por um administrador enquanto estava logado

    const { sessao, setCookie } = await lerSessao(cookie);
    expect(sessao).toBeNull();
    expect(setCookie).toMatch(new RegExp(`${COOKIE.replace(".", "\\.")}=;`));
  });

  it("empresa inativada também encerra a sessão", async () => {
    db.t.empresa[0].ativo = false;
    expect((await lerSessao(await cookieDeSessao())).sessao).toBeNull();
  });

  it("usuário removido do banco: sessão encerrada", async () => {
    db.t.usuario = [];
    expect((await lerSessao(await cookieDeSessao())).sessao).toBeNull();
  });

  it("falha passageira do banco não derruba quem está ativo", async () => {
    falhar.banco = true;
    vi.spyOn(console, "error").mockImplementation(() => {}); // o log do erro é esperado aqui
    expect((await lerSessao(await cookieDeSessao())).sessao?.user?.id).toBe("u1");
  });
});

describe("/sessao-encerrada", () => {
  it("apaga só o cookie de sessão do painel (inclusive em pedaços) e vai para o login", async () => {
    const { GET } = await import("@/app/sessao-encerrada/route");
    const req = new NextRequest("http://localhost/sessao-encerrada", {
      headers: { cookie: "authjs.session-token=a; __Secure-authjs.session-token.0=b; frivo.portal-session-token=c; outro=d" },
    });
    const res = GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login?sessao=encerrada");
    const apagados = res.cookies.getAll().map((c) => c.name).sort();
    expect(apagados).toEqual(["__Secure-authjs.session-token.0", "authjs.session-token"]);
  });

  it("é rota pública no middleware (senão o cookie velho faria /login ↔ /dashboard em loop)", async () => {
    const fonte = await import("node:fs").then((fs) => fs.readFileSync("middleware.ts", "utf8"));
    expect(fonte).toMatch(/"\/sessao-encerrada"/);
  });
});
