/**
 * Atividade esquecida em andamento — o SQL de produção (prisma/sql/2027-02-02_app_atividade_esquecida.sql) rodado de
 * verdade num PostgreSQL descartável: DUAS colunas novas, idempotente, não mexe em mais nada, as linhas que já existem
 * ficam como estavam (início vazio, limite 4 h) e o resultado é EXATAMENTE o que o Prisma espera.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-app-atividade-esquecida
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-02_app_atividade_esquecida.sql");
const SCHEMA = `teste_ativ_esq_${process.pid}`;
const PRISMA = `teste_ativ_esq_prisma_${process.pid}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const coluna = (schema: string, tabela: string, nome: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') || ':' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' AND column_name = '${nome}'`);

describe.skipIf(!URL)("SQL de produção: atividade esquecida em andamento (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    sql(`
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE);
      INSERT INTO "configuracoes" VALUES ('c1', 'e1');
      CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "data_agendada" TIMESTAMP(3));
      INSERT INTO "atividades_os" VALUES ('a1', 'EM_ANDAMENTO', '2026-11-12 12:00'), ('a2', 'CONCLUIDA', NULL);
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("as duas colunas são IDÊNTICAS às do Prisma (tipo, nulo, padrão, precisão)", () => {
    expect(coluna(SCHEMA, "atividades_os", "iniciada_em")).toBe("timestamp without time zone:YES:-:3");
    expect(coluna(SCHEMA, "configuracoes", "app_alerta_andamento_horas")).toBe("integer:NO:4:-");
    expect(coluna(SCHEMA, "atividades_os", "iniciada_em")).toBe(coluna(PRISMA, "atividades_os", "iniciada_em"));
    expect(coluna(SCHEMA, "configuracoes", "app_alerta_andamento_horas")).toBe(coluna(PRISMA, "configuracoes", "app_alerta_andamento_horas"));
  });

  it("nada é reescrito: as atividades existentes ficam com o início vazio; as empresas começam com 4 h", () => {
    expect(sql(`SELECT count(*) FROM "atividades_os" WHERE "iniciada_em" IS NOT NULL`)).toBe("0");
    expect(sql(`SELECT "status" || '|' || coalesce("data_agendada"::text, '-') FROM "atividades_os" ORDER BY "id"`)).toBe("EM_ANDAMENTO|2026-11-12 12:00:00\nCONCLUIDA|-");
    expect(sql(`SELECT "app_alerta_andamento_horas" FROM "configuracoes" WHERE "id" = 'c1'`)).toBe("4");
  });

  it("rodar de novo não desfaz o que a empresa configurou", () => {
    sql(`UPDATE "configuracoes" SET "app_alerta_andamento_horas" = 6 WHERE "id" = 'c1'`);
    psql(["-f", ARQUIVO]);
    expect(sql(`SELECT "app_alerta_andamento_horas" FROM "configuracoes" WHERE "id" = 'c1'`)).toBe("6");
  });

  it("é só aditivo: duas colunas, numa transação, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN|CREATE TABLE)\b/i);
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual(["atividades_os", "configuracoes"]);
  });

  it("o schema do Prisma aponta para as mesmas colunas", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/iniciadaEm\s+DateTime\?\s+@map\("iniciada_em"\)/);
    expect(schema).toMatch(/appAlertaAndamentoHoras\s+Int\s+@default\(4\)\s+@map\("app_alerta_andamento_horas"\)/);
  });
});
