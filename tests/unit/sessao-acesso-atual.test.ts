/**
 * A SESSÃO traz o acesso do cadastro de AGORA (lib/sessao-ativa + lib/acesso/acesso-atual).
 *
 * Usa o Auth.js REAL (lib/auth.ts): monta um cookie de sessão assinado e lê /api/auth/session, que
 * passa pelo mesmo callback `jwt` usado por `auth()` nas páginas e APIs. Banco em memória.
 *
 * O bug (19/11): o RH ganhou "Admissão digital › Gerenciar" com a sessão aberta e continuou em "sem
 * permissão" até sair e entrar; e o contrário — permissão retirada continuava valendo — era pior.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decode, encode } from "next-auth/jwt";
import type { Banco } from "./helpers/banco-memoria";
import { montarPermissoes, permissoesTotais, permissoesVazias, portaoBarra } from "@/lib/permissoes";

const SEGREDO = "segredo-de-teste-acesso-atual-32-caracteres!";
process.env.AUTH_SECRET = SEGREDO;
process.env.AUTH_URL = "http://localhost/api/auth";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  return {
    prisma: criarPrisma(db, {
      usuario: (r, T) => ({
        empresa: T("empresa").find((e) => e.id === r.empresaId),
        perfilAcesso: T("perfilAcesso").find((p) => p.id === r.perfilAcessoId) ?? null,
      }),
    }),
  };
});

const COOKIE = "authjs.session-token";
let handlers: typeof import("@/lib/auth").handlers;
beforeAll(async () => { ({ handlers } = await import("@/lib/auth")); });

const RH = montarPermissoes({ admissao: ["gerenciar"] });
const SO_ORDENS = montarPermissoes({ ordens: ["visualizar"] });
const perfil = () => db.t.perfilAcesso[0];

beforeEach(() => {
  db.t = {
    empresa: [{ id: "e1", ativo: true }],
    perfilAcesso: [{ id: "p1", empresaId: "e1", nome: "Atendimento", ativo: true, permissoes: SO_ORDENS }],
    usuario: [{ id: "u1", empresaId: "e1", nome: "Rita", email: "rita@x.com", ativo: true, role: "OPERADOR", perfilAcessoId: "p1" }],
  };
});

/** O cookie que o navegador tem: o acesso do momento do login. */
async function cookieDoLogin(permissoes = SO_ORDENS, role = "OPERADOR") {
  const token = await encode({
    salt: COOKIE, secret: SEGREDO,
    token: { sub: "u1", id: "u1", name: "Rita", email: "rita@x.com", empresaId: "e1", role, permissoes, perfilNome: "Atendimento" },
  });
  return `${COOKIE}=${token}`;
}

/** Uma "requisição": lê a sessão como `auth()` faz; devolve também o cookie que o servidor regravou. */
async function lerSessao(cookie: string) {
  const res = await handlers.GET(new NextRequest("http://localhost/api/auth/session", { headers: { cookie } }));
  const novo = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
  const valor = novo?.slice(COOKIE.length + 1).split(";")[0];
  return {
    sessao: await res.json(),
    cookieNovo: valor ? `${COOKIE}=${valor}` : null,
    tokenNovo: valor ? await decode({ salt: COOKIE, secret: SEGREDO, token: valor }) : null,
  };
}

describe("conceder acesso com a sessão aberta", () => {
  it("o perfil ganha \"Admissão digital › Gerenciar\": vale na requisição seguinte, sem sair e entrar", async () => {
    const cookie = await cookieDoLogin();
    const antes = await lerSessao(cookie);
    expect(antes.sessao.user.permissoes.admissao?.gerenciar ?? false).toBe(false);
    expect(antes.sessao.user.acessoMudou).toBe(false);

    perfil().permissoes = montarPermissoes({ ordens: ["visualizar"], admissao: ["gerenciar"] }); // o administrador concede

    const depois = await lerSessao(cookie);
    expect(depois.sessao.user.permissoes.admissao.gerenciar).toBe(true);
    expect(depois.sessao.user.acessoMudou, "o cookie que chegou estava desatualizado").toBe(true);
    // o cookie regravado já traz o acesso novo — é ele que o portão do middleware lê
    expect((depois.tokenNovo as any).permissoes.admissao.gerenciar).toBe(true);
    expect(portaoBarra("/admissoes", (depois.tokenNovo as any).permissoes, (depois.tokenNovo as any).role)).toBe(false);

    // com o cookie novo, nada mais a sincronizar
    const seguinte = await lerSessao(depois.cookieNovo!);
    expect(seguinte.sessao.user.acessoMudou).toBe(false);
    expect(seguinte.sessao.user.permissoes.admissao.gerenciar).toBe(true);
  });
});

describe("retirar acesso com a sessão aberta", () => {
  it("permissão retirada do perfil: some na requisição seguinte (página, API e o cookie do portão)", async () => {
    perfil().permissoes = RH;
    const cookie = await cookieDoLogin(RH);
    expect((await lerSessao(cookie)).sessao.user.permissoes.admissao.gerenciar).toBe(true);

    perfil().permissoes = SO_ORDENS; // o administrador retira

    const { sessao, tokenNovo } = await lerSessao(cookie);
    expect(sessao.user.permissoes.admissao?.gerenciar ?? false).toBe(false);
    expect(sessao.user.acessoMudou).toBe(true);
    expect(portaoBarra("/admissoes", (tokenNovo as any).permissoes, (tokenNovo as any).role)).toBe(true);
  });

  it("perfil inativado: só o Dashboard, e o nome do perfil sai", async () => {
    perfil().ativo = false;
    const { sessao } = await lerSessao(await cookieDoLogin());
    expect(sessao.user.permissoes).toEqual(permissoesVazias());
    expect(sessao.user.perfilNome).toBeNull();
  });

  it("perfil retirado do usuário: só o Dashboard", async () => {
    db.t.usuario[0].perfilAcessoId = null;
    expect((await lerSessao(await cookieDoLogin())).sessao.user.permissoes).toEqual(permissoesVazias());
  });

  it("deixou de ser administrador master: perde o acesso total", async () => {
    const { sessao } = await lerSessao(await cookieDoLogin(permissoesTotais(), "ADMIN"));
    expect(sessao.user.role).toBe("OPERADOR");
    expect(sessao.user.permissoes).toEqual(SO_ORDENS);
    expect(sessao.user.acessoMudou).toBe(true);
  });

  it("virou administrador master: acesso total", async () => {
    db.t.usuario[0].role = "ADMIN";
    const { sessao } = await lerSessao(await cookieDoLogin());
    expect(sessao.user.role).toBe("ADMIN");
    expect(sessao.user.permissoes).toEqual(permissoesTotais());
  });
});

describe("o que continua como antes", () => {
  it("usuário inativado perde a sessão (e não volta com acesso novo)", async () => {
    db.t.usuario[0].ativo = false;
    expect((await lerSessao(await cookieDoLogin())).sessao).toBeNull();
  });

  it("o acesso é o do PRÓPRIO usuário: o perfil de outro usuário não vaza", async () => {
    db.t.perfilAcesso.push({ id: "p2", empresaId: "e1", nome: "Financeiro", ativo: true, permissoes: permissoesTotais() });
    db.t.usuario.push({ id: "u2", empresaId: "e1", nome: "Beto", email: "b@x.com", ativo: true, role: "OPERADOR", perfilAcessoId: "p2" });
    const { sessao } = await lerSessao(await cookieDoLogin());
    expect(sessao.user.permissoes).toEqual(SO_ORDENS);
    expect(sessao.user.empresaId).toBe("e1");
  });
});
