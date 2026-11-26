/**
 * ACESSO ATUAL em PostgreSQL real: a consulta por requisição de lib/sessao-ativa (agora com papel e
 * perfil) roda contra o schema de verdade, e o Auth.js real devolve a sessão com o acesso de agora.
 *
 * O cenário é o da implantação: o RH está logado; o administrador edita o perfil dele no cadastro;
 * a requisição seguinte do RH já traz o acesso novo — e o cookie regravado também, para o portão.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { decode, encode } from "next-auth/jwt";
import { montarPermissoes, permissoesVazias, portaoBarra } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_acesso_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const SEGREDO = "segredo-de-teste-acesso-pg-com-32-caracteres!";
const COOKIE = "authjs.session-token";

describe.skipIf(!URL_PG)("acesso do cadastro de agora (PostgreSQL real + Auth.js real)", () => {
  let prisma: any;
  let handlers: typeof import("@/lib/auth").handlers;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.AUTH_SECRET = SEGREDO;
    process.env.AUTH_URL = "http://localhost/api/auth";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ handlers } = await import("@/lib/auth"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total LTDA", cnpj: "12.345.678/0001-90", email: "c@climatotal.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.perfilAcesso.createMany({ data: [
      { id: "pRh", empresaId: "e1", nome: "RH", tipo: "PERSONALIZADO", cor: "#8B5CF6", permissoes: montarPermissoes({ equipes: ["visualizar"] }) },
      { id: "pOutra", empresaId: "e2", nome: "Tudo", tipo: "PERSONALIZADO", cor: "#8B5CF6", permissoes: montarPermissoes({ admissao: ["gerenciar"] }) },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uRh", empresaId: "e1", nome: "Rita do RH", email: "rita@climatotal.com", senha: "x", role: "OPERADOR", perfilAcessoId: "pRh" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x", role: "OPERADOR", perfilAcessoId: "pOutra" },
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const cookieDoLogin = async () => `${COOKIE}=${await encode({
    salt: COOKIE, secret: SEGREDO,
    token: { sub: "uRh", id: "uRh", name: "Rita do RH", email: "rita@climatotal.com", empresaId: "e1", role: "OPERADOR", permissoes: montarPermissoes({ equipes: ["visualizar"] }) },
  })}`;

  async function lerSessao(cookie: string) {
    const res = await handlers.GET(new NextRequest("http://localhost/api/auth/session", { headers: { cookie } }));
    const valor = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1).split(";")[0];
    return { sessao: await res.json(), token: valor ? ((await decode({ salt: COOKIE, secret: SEGREDO, token: valor })) as any) : null };
  }

  it("o administrador concede \"Admissão digital › Gerenciar\" ao perfil: a próxima requisição já entra em /admissoes", async () => {
    const cookie = await cookieDoLogin();
    const antes = await lerSessao(cookie);
    expect(portaoBarra("/admissoes", antes.sessao.user.permissoes, antes.sessao.user.role)).toBe(true);

    await prisma.perfilAcesso.update({ where: { id: "pRh" }, data: { permissoes: montarPermissoes({ equipes: ["visualizar"], admissao: ["gerenciar"] }) } });

    const depois = await lerSessao(cookie);
    expect(depois.sessao.user.acessoMudou).toBe(true);
    expect(portaoBarra("/admissoes", depois.sessao.user.permissoes, depois.sessao.user.role)).toBe(false);
    expect(portaoBarra("/admissoes", depois.token.permissoes, depois.token.role), "o cookie regravado (o que o middleware lê)").toBe(false);
  });

  it("o administrador inativa o perfil: a próxima requisição fica só com o Dashboard", async () => {
    await prisma.perfilAcesso.update({ where: { id: "pRh" }, data: { ativo: false } });
    const { sessao } = await lerSessao(await cookieDoLogin());
    expect(sessao.user.permissoes).toEqual(permissoesVazias());
    expect(portaoBarra("/colaboradores", sessao.user.permissoes, sessao.user.role)).toBe(true);
    await prisma.perfilAcesso.update({ where: { id: "pRh" }, data: { ativo: true } });
  });

  it("multiempresa: o acesso vem do perfil do próprio usuário — o perfil de outra empresa nunca entra", async () => {
    await prisma.perfilAcesso.update({ where: { id: "pRh" }, data: { permissoes: montarPermissoes({ equipes: ["visualizar"] }) } });
    const { sessao } = await lerSessao(await cookieDoLogin());
    expect(sessao.user.empresaId).toBe("e1");
    expect(sessao.user.permissoes.admissao?.gerenciar ?? false).toBe(false);
  });
});
