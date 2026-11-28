/**
 * Pausar / impedimento — o SQL de produção (prisma/sql/2027-02-21_atividade_pausas.sql) rodado de verdade num
 * PostgreSQL descartável: um tipo e duas tabelas novos, idempotente (3×), aditivo e IDÊNTICO ao que o Prisma espera
 * (colunas, índices, chaves estrangeiras e o tipo).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-atividade-pausas
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-21_atividade_pausas.sql");
const SCHEMA = `teste_pausas_sql_${process.pid}`;
const PRISMA = `teste_pausas_prisma_${process.pid}`;
const TABELAS = ["motivos_pausa", "atividade_pausas"];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);
const colunas = (schema: string) => sql(`SELECT table_name || '.' || column_name || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name IN ('motivos_pausa', 'atividade_pausas') ORDER BY table_name, column_name`, schema)
  .replaceAll(`${schema}.`, "");
const indices = (schema: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename IN ('motivos_pausa', 'atividade_pausas') ORDER BY indexname`, schema);
const chaves = (schema: string) => sql(`SELECT c.conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = '${schema}' AND c.conrelid::regclass::text IN ('motivos_pausa', 'atividade_pausas') ORDER BY c.conname`, schema);
const tipo = (schema: string) => sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${schema}' AND t.typname = 'TipoMotivoPausa'`, schema);

describe.skipIf(!URL)("SQL de produção: pausar / impedimento (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    // o que já existe em produção (só o que as chaves estrangeiras precisam), com dados
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "status" TEXT NOT NULL);
      INSERT INTO "empresas" VALUES ('e1'); INSERT INTO "usuarios" VALUES ('u1');
      INSERT INTO "atividades_os" VALUES ('a1', 'EM_ANDAMENTO'), ('a2', 'CONCLUIDA');
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 3×: idempotente
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("as duas tabelas e o tipo são IDÊNTICOS aos do Prisma (colunas, índices, chaves estrangeiras)", () => {
    expect(colunas(SCHEMA)).toBe(colunas(PRISMA));
    expect(colunas(SCHEMA).split("\n")).toHaveLength(8 + 14);
    expect(indices(SCHEMA)).toBe(indices(PRISMA));
    expect(chaves(SCHEMA)).toBe(chaves(PRISMA));
    expect(tipo(SCHEMA)).toBe("IMPEDIMENTO,INTERVALO");
    expect(tipo(SCHEMA)).toBe(tipo(PRISMA));
  });

  it("nada que já existia muda; a pausa grava e o client_id não repete; apagar a atividade leva as pausas", () => {
    expect(sql(`SELECT string_agg(id || ':' || status, ',' ORDER BY id) FROM "atividades_os"`)).toBe("a1:EM_ANDAMENTO,a2:CONCLUIDA");
    sql(`INSERT INTO "motivos_pausa" ("id", "empresa_id", "nome") VALUES ('m1', 'e1', 'Falta de peça/material')`);
    sql(`INSERT INTO "atividade_pausas" ("id", "empresa_id", "atividade_id", "motivo_id", "motivo", "inicio", "client_id", "pausado_por_id") VALUES ('p1', 'e1', 'a1', 'm1', 'Falta de peça/material', now(), 'c-1', 'u1')`);
    expect(sql(`SELECT "impedimento" || '|' || "nao_concluida" || '|' || coalesce("fim"::text, '-') FROM "atividade_pausas" WHERE "id" = 'p1'`)).toBe("true|false|-");
    expect(() => sql(`INSERT INTO "atividade_pausas" ("id", "empresa_id", "atividade_id", "motivo", "inicio", "client_id") VALUES ('p2', 'e1', 'a1', 'x', now(), 'c-1')`)).toThrow();
    expect(() => sql(`INSERT INTO "motivos_pausa" ("id", "empresa_id", "nome") VALUES ('m2', 'e1', 'Falta de peça/material')`)).toThrow(); // nome único por empresa
    // motivo apagado: a pausa fica com o texto gravado
    sql(`DELETE FROM "motivos_pausa" WHERE "id" = 'm1'`);
    expect(sql(`SELECT coalesce("motivo_id", '-') || '|' || "motivo" FROM "atividade_pausas" WHERE "id" = 'p1'`)).toBe("-|Falta de peça/material");
    sql(`DELETE FROM "atividades_os" WHERE "id" = 'a1'`);
    expect(sql(`SELECT count(*) FROM "atividade_pausas"`)).toBe("0");
    // rodar de novo depois de usado não mexe em nada
    sql(`INSERT INTO "motivos_pausa" ("id", "empresa_id", "nome", "ativo") VALUES ('m3', 'e1', 'Almoço/intervalo', false)`);
    psql(["-f", ARQUIVO]);
    expect(sql(`SELECT "ativo"::text FROM "motivos_pausa" WHERE "id" = 'm3'`)).toBe("false");
  });

  it("é só aditivo: numa transação, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN, e só cria o que é dele", () => {
    // "ON DELETE/UPDATE CASCADE" das chaves estrangeiras não é comando: sai antes de procurar os proibidos
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/g, "");
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN|INSERT)\b/i);
    expect([...fonte.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z_]+)"/g)].map((m) => m[1]).sort()).toEqual([...TABELAS].sort());
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual([...TABELAS].sort());
  });
});
