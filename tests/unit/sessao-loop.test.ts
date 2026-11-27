/**
 * HOTFIX: ERR_TOO_MANY_REDIRECTS — o loop /login → /dashboard → /sessao-encerrada → /login.
 *
 * Em produção (HTTPS) o cookie da sessão se chama `__Secure-authjs.session-token`, e o navegador RECUSA
 * um Set-Cookie com esse nome sem `Secure`. /sessao-encerrada apagava sem `Secure`: o cookie ficava, o
 * middleware o via válido e o ciclo não terminava.
 *
 * Aqui tudo roda como em produção: HTTPS, Auth.js real, middleware real, a rota real e um "navegador"
 * que segue os redirecionamentos e aplica as regras de cookie de verdade (recusa __Secure- sem Secure).
 * Prova:
 *  - o Set-Cookie que apaga tem Secure (no __Secure-), HttpOnly, SameSite=Lax, Path=/ e Max-Age=0, em
 *    todos os pedaços; o que regrava (troca de senha) também;
 *  - o técnico com o nonce velho cai UMA vez no login, com a mensagem do outro aparelho — sem loop;
 *  - mesmo que o navegador não apague o cookie, o login aparece (a blindagem do middleware);
 *  - administrador com dois aparelhos não cai; o logout do Auth.js apaga com Secure.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import type { Banco } from "./helpers/banco-memoria";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";

const SEGREDO = "segredo-de-teste-hotfix-com-32-caracteres!";
process.env.AUTH_SECRET = SEGREDO;
process.env.AUTH_URL = "https://frivo.exemplo/api/auth";
const BASE = "https://frivo.exemplo";
const COOKIE = "__Secure-authjs.session-token";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  return { prisma: criarPrisma(db, { usuario: (r, T) => ({ empresa: T("empresa").find((e) => e.id === r.empresaId) }) }) };
});

let handlers: typeof import("@/lib/auth").handlers;
let middleware: (req: NextRequest, ev: unknown) => Promise<Response>;
let sessaoEncerrada: typeof import("@/app/sessao-encerrada/route").GET;
beforeAll(async () => {
  ({ handlers } = await import("@/lib/auth"));
  middleware = (await import("@/middleware")).default as never;
  sessaoEncerrada = (await import("@/app/sessao-encerrada/route")).GET;
});

beforeEach(() => {
  db.t = {
    // As duas empresas de produção têm "apenas um dispositivo ativo" ligado
    empresa: [{ id: "e1", ativo: true, configuracao: { appUmDispositivo: true } }],
    usuario: [
      { id: "uT", empresaId: "e1", nome: "Carlos", email: "carlos@x.com", ativo: true, role: "TECNICO", sessaoAtiva: "nonce-NOVO" },
      { id: "uA", empresaId: "e1", nome: "Zé", email: "ze@x.com", ativo: true, role: "ADMIN", sessaoAtiva: "nonce-NOVO" },
    ],
  };
});

/** O cookie de um aparelho: o token como o login grava (o nonce `sa` é o do login DAQUELE aparelho) */
async function tokenDoAparelho(usuario: "uT" | "uA", nonce: string) {
  const tecnico = usuario === "uT";
  return encode({
    salt: COOKIE, secret: SEGREDO,
    token: { sub: usuario, id: usuario, name: tecnico ? "Carlos" : "Zé", email: tecnico ? "carlos@x.com" : "ze@x.com", empresaId: "e1",
      role: tecnico ? "TECNICO" : "ADMIN", permissoes: tecnico ? PRESETS.TECNICO : permissoesTotais(), tecnicoId: tecnico ? "t1" : null, sa: nonce, lembrar: true, loginEm: Date.now() },
  });
}

/** Um navegador: guarda cookies e aplica as regras de verdade (o __Secure- sem Secure é recusado). */
class Navegador {
  jar = new Map<string, string>();
  constructor(private naoApaga = false) {}
  receber(res: Response) {
    for (const linha of res.headers.getSetCookie()) {
      const [par, ...attrs] = linha.split(";").map((x) => x.trim());
      const i = par.indexOf("=");
      const nome = par.slice(0, i), valor = par.slice(i + 1);
      const a = attrs.map((x) => x.toLowerCase());
      if (nome.startsWith("__Secure-") && !a.includes("secure")) continue; // RFC 6265bis: recusado
      const apaga = a.includes("max-age=0") || a.some((x) => x.startsWith("expires=") && new Date(x.slice(8)).getTime() <= Date.now());
      if (apaga) { if (!this.naoApaga) this.jar.delete(nome); } else this.jar.set(nome, valor);
    }
  }
  cookie = () => [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  temSessao = () => [...this.jar.keys()].some((k) => k.startsWith(COOKIE));
}

/**
 * Abre um endereço e segue os redirecionamentos como o navegador (no máximo 10). As páginas do painel e
 * do app fazem o que o layout faz: `auth()` sem sessão → redirect("/sessao-encerrada") (componente de
 * servidor não grava cookie).
 */
async function abrir(nav: Navegador, caminho: string) {
  let url = new URL(caminho, BASE);
  const passos: string[] = [];
  for (let i = 0; i < 10; i++) {
    passos.push(url.pathname + url.search);
    const pedido = () => new NextRequest(url, { headers: { cookie: nav.cookie() } });
    let res = await middleware(pedido(), {});
    nav.receber(res);
    let destino = res.headers.get("location");
    if (!destino && url.pathname === "/sessao-encerrada") {
      res = await sessaoEncerrada(pedido());
      nav.receber(res);
      destino = res.headers.get("location");
    } else if (!destino && ["/dashboard", "/tecnico"].includes(url.pathname)) {
      const s = await handlers.GET(new NextRequest(new URL("/api/auth/session", BASE), { headers: { cookie: nav.cookie() } }));
      if (!(await s.json())) destino = new URL("/sessao-encerrada", BASE).href;
    }
    if (!destino) return { passos, final: url.pathname + url.search, status: res.status };
    url = new URL(destino, BASE);
  }
  throw new Error(`loop de redirecionamento: ${passos.join(" → ")}`);
}

const linhas = (res: Response) => res.headers.getSetCookie();
const doCookie = (res: Response, nome: string) => linhas(res).find((l) => l.startsWith(`${nome}=`)) ?? "";

describe("o Set-Cookie que apaga (e o que regrava) usa os atributos do Auth.js", () => {
  it("/sessao-encerrada: Secure no __Secure-, HttpOnly, SameSite=Lax, Path=/ e Max-Age=0 — em todos os pedaços", async () => {
    const req = new NextRequest(`${BASE}/sessao-encerrada`, { headers: { cookie: `${COOKIE}.0=a; ${COOKIE}.1=b; authjs.session-token=c; frivo.portal-session-token=d` } });
    const res = await sessaoEncerrada(req);
    for (const nome of [COOKIE, `${COOKIE}.0`, `${COOKIE}.1`]) {
      const l = doCookie(res, nome);
      expect(l, nome).toMatch(/;\s*Secure/i);
      expect(l, nome).toMatch(/;\s*HttpOnly/i);
      expect(l, nome).toMatch(/;\s*SameSite=Lax/i);
      expect(l, nome).toMatch(/;\s*Path=\/(;|$)/);
      expect(l, nome).toMatch(/;\s*Max-Age=0/i);
    }
    // o nome sem o prefixo (http, desenvolvimento) não leva Secure; o portal não é tocado
    expect(doCookie(res, "authjs.session-token")).not.toMatch(/Secure/i);
    expect(doCookie(res, "authjs.session-token")).toMatch(/Max-Age=0/i);
    expect(doCookie(res, "frivo.portal-session-token")).toBe("");
  });

  it("regravar a sessão (troca de senha no perfil): o cookie novo e os pedaços apagados levam Secure", async () => {
    const { regravarSessaoAtual } = await import("@/lib/acesso/sessao-cookie");
    const token = await tokenDoAparelho("uA", "nonce-NOVO");
    const meio = Math.ceil(token.length / 2);
    const req = new NextRequest(`${BASE}/api/perfil/senha`, { headers: { cookie: `${COOKIE}.0=${token.slice(0, meio)}; ${COOKIE}.1=${token.slice(meio)}` } });
    const res = NextResponse.json({ ok: true });
    expect(await regravarSessaoAtual(req, res, (t) => ({ ...t, fs: "nova" }))).toBe(true);
    const novo = doCookie(res, COOKIE);
    expect(novo).not.toMatch(new RegExp(`^${COOKIE.replace(/\./g, "\\.")}=;`)); // tem valor
    expect(novo).toMatch(/;\s*Secure/i);
    expect(novo).toMatch(/;\s*HttpOnly/i);
    for (const pedaco of [`${COOKIE}.0`, `${COOKIE}.1`]) {
      expect(doCookie(res, pedaco), pedaco).toMatch(/Max-Age=0/i);
      expect(doCookie(res, pedaco), pedaco).toMatch(/;\s*Secure/i);
    }
    // o navegador fica com um cookie só, o novo
    const nav = new Navegador();
    nav.jar.set(`${COOKIE}.0`, "x"); nav.jar.set(`${COOKIE}.1`, "y");
    nav.receber(res);
    expect([...nav.jar.keys()]).toEqual([COOKIE]);
  });

  it("logout (signOut do Auth.js): apaga o __Secure- com Secure", async () => {
    const c = await handlers.GET(new NextRequest(`${BASE}/api/auth/csrf`));
    const { csrfToken } = await c.json();
    const csrf = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
    const res = await handlers.POST(new NextRequest(`${BASE}/api/auth/signout`, {
      method: "POST", body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE}/login` }),
      headers: { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1", cookie: `${csrf}; ${COOKIE}=${await tokenDoAparelho("uA", "nonce-NOVO")}` },
    }));
    const l = doCookie(res, COOKIE);
    expect(l).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect(l).toMatch(/;\s*Secure/i);
  });
});

describe("o ciclo: técnico com o nonce velho (entrou em outro aparelho)", () => {
  it("cai UMA vez no login, com a mensagem do outro aparelho; o cookie some; abrir de novo não volta ao ciclo", async () => {
    const nav = new Navegador();
    nav.jar.set(COOKIE, await tokenDoAparelho("uT", "nonce-VELHO"));
    const r = await abrir(nav, "/tecnico");
    expect(r.passos).toEqual(["/tecnico", "/sessao-encerrada", "/login?sessao=encerrada&motivo=outro-aparelho"]);
    expect(r.status).toBe(200);
    expect(nav.temSessao()).toBe(false);
    // o Zé tenta o endereço de novo: sem cookie, o login (com o destino guardado), sem ciclo
    expect((await abrir(nav, "/dashboard")).final).toBe("/login?callbackUrl=%2Fdashboard");
    expect((await abrir(nav, "/")).status).toBe(200);
  });

  it("blindagem: mesmo que o navegador NÃO apague o cookie, o login aparece (sem ERR_TOO_MANY_REDIRECTS)", async () => {
    const nav = new Navegador(true); // não apaga nada
    nav.jar.set(COOKIE, await tokenDoAparelho("uT", "nonce-VELHO"));
    const r = await abrir(nav, "/dashboard");
    expect(r.final).toBe("/login?sessao=encerrada&motivo=outro-aparelho");
    expect(r.status).toBe(200);
    expect(nav.temSessao()).toBe(true); // o cookie velho ficou…
    // …e o login continua aparecendo, mesmo pedido de novo (o middleware não manda ao /dashboard)
    const deNovo = await abrir(nav, "/login?sessao=encerrada");
    expect([deNovo.passos, deNovo.status]).toEqual([["/login?sessao=encerrada"], 200]);
  });

  it("o middleware, no login aberto por /sessao-encerrada, mostra o login e apaga de novo (com Secure, todos os pedaços)", async () => {
    const token = await tokenDoAparelho("uT", "nonce-VELHO");
    const res = await middleware(new NextRequest(`${BASE}/login?sessao=encerrada`, { headers: { cookie: `${COOKIE}.0=${token.slice(0, 50)}; ${COOKIE}.1=${token.slice(50)}` } }), {});
    expect(res.headers.get("location")).toBeNull();
    for (const nome of [COOKIE, `${COOKIE}.0`, `${COOKIE}.1`]) {
      expect(doCookie(res, nome), nome).toMatch(/Max-Age=0/i);
      expect(doCookie(res, nome), nome).toMatch(/;\s*Secure/i);
    }
    // sem o ?sessao=encerrada, o login de quem está logado leva ao trabalho, como sempre (e não apaga nada)
    const normal = await middleware(new NextRequest(`${BASE}/login`, { headers: { cookie: `${COOKIE}=${token}` } }), {});
    expect(normal.headers.get("location")).toBe(`${BASE}/tecnico`);
    expect(doCookie(normal, COOKIE)).toBe("");
  });

  it("o técnico com o nonce ATUAL segue no app", async () => {
    const nav = new Navegador();
    nav.jar.set(COOKIE, await tokenDoAparelho("uT", "nonce-NOVO"));
    expect((await abrir(nav, "/tecnico")).final).toBe("/tecnico");
  });
});

describe("administrador e escritório: dois aparelhos não derrubam", () => {
  it("o notebook (nonce velho) e o celular (nonce novo) seguem no painel, com a trava ligada", async () => {
    const notebook = new Navegador();
    notebook.jar.set(COOKIE, await tokenDoAparelho("uA", "nonce-VELHO"));
    const celular = new Navegador();
    celular.jar.set(COOKIE, await tokenDoAparelho("uA", "nonce-NOVO"));
    for (const nav of [notebook, celular]) {
      const r = await abrir(nav, "/dashboard");
      expect(r.final).toBe("/dashboard");
      expect(nav.temSessao()).toBe(true);
    }
    // e o login, logado, ainda leva ao painel (só o ?sessao=encerrada segura o login)
    expect((await abrir(notebook, "/login")).passos).toEqual(["/login", "/dashboard"]);
  });
});
