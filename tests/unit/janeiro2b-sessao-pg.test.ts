/**
 * D2 — a sessão do APP DO TÉCNICO vale 30 dias (mesmo sem "Manter conectado"); o escritório segue com a caixa.
 * E o que derruba na hora continua derrubando, também nesse token de 30 dias (PostgreSQL real, a regra de verdade:
 * lib/sessao-ativa): inativar o usuário, "um aparelho só" (entrou em outro celular) e redefinir/trocar a senha.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/janeiro2b-sessao-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { lembrarNoLogin, sessaoCurtaVencida, SESSAO_CURTA_MS } from "@/lib/acesso/sessao";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_sessao_d2_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const DIA = 24 * 3_600_000;

describe("D2: quanto a sessão dura", () => {
  it("app do técnico: 30 dias, com ou sem a caixa; escritório: a escolha da caixa", () => {
    expect(lembrarNoLogin(false, true)).toBe(true);
    expect(lembrarNoLogin(true, true)).toBe(true);
    expect(lembrarNoLogin(true, false)).toBe(true);
    expect(lembrarNoLogin(false, false)).toBe(false);
  });
  it("o login usa a regra com o modo técnico (o mesmo do app e do 'um aparelho só')", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "lib/auth.ts"), "utf8");
    expect(fonte).toContain("lembrar: lembrarNoLogin(lembrar, emModoTecnico({ role: usuario.role, permissoes, tecnicoId: tecnico?.id ?? null })),");
  });
});

describe.skipIf(!URL_PG)("D2: o token de 30 dias do técnico ainda cai na hora (PostgreSQL real)", () => {
  let prisma: any;
  let jwt: (p: any) => any;
  let motivoDoToken: (t: any) => Promise<string | null>;
  let impressaoDaSenha: (s: string) => string;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    jwt = (await import("@/auth.config")).authConfig.callbacks!.jwt as any;
    ({ motivoDoToken } = await import("@/lib/sessao-ativa"));
    ({ impressaoDaSenha } = await import("@/lib/acesso/impressao-senha"));
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima", cnpj: "1", email: "e@x.com" } });
    await prisma.configuracao.create({ data: { empresaId: "e1", appUmDispositivo: true } });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João", email: "joao@x.com", senha: "hash-1", role: "TECNICO", sessaoAtiva: "nonce-1" },
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "hash-a", role: "ADMIN", sessaoAtiva: "nonce-a" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João", cpf: "1", telefone: "1", email: "joao@x.com" } });
  }, 180_000);
  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /** O token como o login monta (lib/auth › authorize → auth.config › jwt) */
  const entrar = (u: { id: string; role: string; tecnicoId: string | null; senha: string; sa: string; caixa: boolean }) => jwt({
    token: {},
    user: { id: u.id, empresaId: "e1", role: u.role, permissoes: u.role === "TECNICO" ? PRESETS.TECNICO : permissoesTotais(), tecnicoId: u.tecnicoId,
      lembrar: lembrarNoLogin(u.caixa, u.role === "TECNICO"), fs: impressaoDaSenha(u.senha), sessaoAtiva: u.sa },
  });

  it("técnico sem a caixa: 10 dias depois o token ainda vale; escritório sem a caixa cai depois de 1 dia", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const agora = Date.now();
    const tecnico = entrar({ id: "uT", role: "TECNICO", tecnicoId: "t1", senha: "hash-1", sa: "nonce-1", caixa: false });
    const escritorio = entrar({ id: "uA", role: "ADMIN", tecnicoId: null, senha: "hash-a", sa: "nonce-a", caixa: false });
    expect(tecnico.lembrar).toBe(true);
    expect(escritorio.lembrar).toBe(false);
    vi.setSystemTime(agora + 10 * DIA);
    expect(sessaoCurtaVencida(tecnico)).toBe(false);
    expect(jwt({ token: tecnico })).not.toBeNull();
    expect(await motivoDoToken(tecnico)).toBeNull(); // o servidor também aceita
    vi.setSystemTime(agora + SESSAO_CURTA_MS + 60_000);
    expect(jwt({ token: { ...escritorio } })).toBeNull();
    vi.useRealTimers();
  });

  it("…mas cai na hora: entrou em outro celular ('um aparelho só'), senha redefinida, usuário inativado", async () => {
    const tecnico = entrar({ id: "uT", role: "TECNICO", tecnicoId: "t1", senha: "hash-1", sa: "nonce-1", caixa: false });
    expect(await motivoDoToken(tecnico)).toBeNull();
    // entrou em outro celular: o login regrava o nonce
    await prisma.usuario.update({ where: { id: "uT" }, data: { sessaoAtiva: "nonce-2" } });
    expect(await motivoDoToken(tecnico)).toBe("outro-aparelho");
    await prisma.usuario.update({ where: { id: "uT" }, data: { sessaoAtiva: "nonce-1" } });
    expect(await motivoDoToken(tecnico)).toBeNull();
    // o escritório redefiniu o acesso (senha nova)
    await prisma.usuario.update({ where: { id: "uT" }, data: { senha: "hash-2" } });
    expect(await motivoDoToken(tecnico)).toBe("senha");
    await prisma.usuario.update({ where: { id: "uT" }, data: { senha: "hash-1" } });
    // inativado
    await prisma.usuario.update({ where: { id: "uT" }, data: { ativo: false } });
    expect(await motivoDoToken(tecnico)).toBe("inativo");
    await prisma.usuario.update({ where: { id: "uT" }, data: { ativo: true } });
    expect(await motivoDoToken(tecnico)).toBeNull();
  });
});
