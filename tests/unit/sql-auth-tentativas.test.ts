/**
 * Autenticação — Fase A: o SQL de produção (prisma/sql/2026-10-20_auth_tentativas.sql) rodado de
 * verdade num PostgreSQL, DUAS vezes, num schema descartável. Depois, a lib de limite de verdade
 * (lib/acesso/limite) com o Prisma real sobre a tabela que o SQL criou — prova que o model do
 * schema.prisma bate com a tabela (nomes, tipos) e que o bloqueio funciona no banco de verdade.
 *
 * Precisa de PostgreSQL + psql: roda quando PG_TESTE_URL está definido (o CI sobe um Postgres).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-auth-tentativas
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL_PG = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-20_auth_tentativas.sql");
const SCHEMA = `teste_auth_tent_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8",
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);

describe.skipIf(!URL_PG)("SQL de produção: tentativas de acesso (PostgreSQL real)", () => {
  let prisma: any;
  let limite: typeof import("@/lib/acesso/limite");

  beforeAll(async () => {
    execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    psql(["-f", ARQUIVO]);
    // uma linha gravada entre as duas execuções tem que sobreviver à segunda
    sql(`INSERT INTO "tentativas_acesso" ("id", "tipo", "chave") VALUES ('antes', 'LOGIN', 'email:x')`);
    psql(["-f", ARQUIVO]);

    process.env.DATABASE_URL = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    limite = await import("@/lib/acesso/limite");
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria a tabela com as colunas certas (rodando 2x não dá erro nem duplica)", () => {
    expect(sql(`SELECT column_name, data_type, is_nullable, COALESCE(column_default, '-') FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = 'tentativas_acesso' ORDER BY ordinal_position`).split("\n")).toEqual([
      "id|text|NO|-",
      "tipo|text|NO|-",
      "chave|text|NO|-",
      "criado_em|timestamp without time zone|NO|CURRENT_TIMESTAMP",
    ]);
    expect(sql(`SELECT count(*) FROM pg_tables WHERE schemaname = '${SCHEMA}'`)).toBe("1");
  });

  it("índices: (tipo, chave, criado_em) para contar e (criado_em) para a limpeza — sem repetir", () => {
    expect(sql(`SELECT indexname FROM pg_indexes WHERE schemaname = '${SCHEMA}' ORDER BY 1`).split("\n")).toEqual([
      "tentativas_acesso_criado_em_idx",
      "tentativas_acesso_pkey",
      "tentativas_acesso_tipo_chave_criado_em_idx",
    ]);
    expect(sql(`SELECT indexdef FROM pg_indexes WHERE indexname = 'tentativas_acesso_tipo_chave_criado_em_idx' AND schemaname = '${SCHEMA}'`))
      .toMatch(/\(tipo, chave, criado_em\)/);
  });

  it("a segunda execução não apaga nada", () => {
    expect(sql(`SELECT "id", "tipo", "chave", "criado_em" IS NOT NULL FROM "tentativas_acesso" WHERE "id" = 'antes'`)).toBe("antes|LOGIN|email:x|t");
  });

  it("a lib de limite com o Prisma real: 5 erros bloqueiam, acertar zera, o IP continua contando, só hash no banco", async () => {
    const agora = new Date();
    const alvos = { email: "Ana@X.com", ip: "189.1.2.3" };
    for (let i = 0; i < 4; i++) await limite.registrarTentativa("LOGIN", alvos, agora);
    expect(await limite.conferirBloqueio("LOGIN", alvos, agora)).toEqual({ bloqueado: false });
    await limite.registrarTentativa("LOGIN", alvos, agora);
    expect(await limite.conferirBloqueio("LOGIN", alvos, agora)).toMatchObject({ bloqueado: true, minutos: 15 });
    expect(await limite.conferirBloqueio("LOGIN", { email: "ana@x.com" }, new Date(agora.getTime() + 15 * 60_000 + 1))).toEqual({ bloqueado: false });

    await limite.limparTentativas("LOGIN", { email: "ana@x.com" });
    expect(await limite.conferirBloqueio("LOGIN", { email: "ana@x.com" }, agora)).toEqual({ bloqueado: false });
    expect(await prisma.tentativaAcesso.count({ where: { tipo: "LOGIN", chave: { startsWith: "ip:" } } })).toBe(5);
    expect(sql(`SELECT count(*) FROM "tentativas_acesso" WHERE "chave" ILIKE '%ana@x.com%' OR "chave" LIKE '%189.1.2.3%'`)).toBe("0");
  });

  it("limpa sozinha o que passou de 1 dia", async () => {
    await prisma.tentativaAcesso.create({ data: { tipo: "ESQUECI_SENHA", chave: "email:velha", criadoEm: new Date(Date.now() - 25 * 3600_000) } });
    await limite.registrarTentativa("ESQUECI_SENHA", { email: "nova@x.com" });
    expect(await prisma.tentativaAcesso.count({ where: { chave: "email:velha" } })).toBe(0);
    expect(await prisma.tentativaAcesso.count({ where: { tipo: "ESQUECI_SENHA" } })).toBe(1);
  });
});
