/**
 * Comentários na OS — o SQL de produção (prisma/sql/2027-02-03_app_comentarios_os.sql) rodado de verdade num PostgreSQL
 * descartável: DUAS tabelas novas, idempotente (roda duas vezes), não mexe em mais nada, e o resultado é EXATAMENTE o
 * que o Prisma espera (comparado com o schema.prisma aplicado por `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-app-comentarios-os
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-03_app_comentarios_os.sql");
const SCHEMA = `teste_coment_${process.pid}`;
const PRISMA = `teste_coment_prisma_${process.pid}`;
const TABELAS = ["os_comentarios", "os_comentarios_lidos"];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const colunas = (schema: string, t: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${t}' ORDER BY column_name`);
const indices = (schema: string, t: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${t}' ORDER BY indexname`);
const chaves = (schema: string, t: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${t}'::regclass ORDER BY conname`);

describe.skipIf(!URL)("SQL de produção: comentários na OS (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    sql(`CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY); CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY);
      INSERT INTO "ordens_servico" VALUES ('os1'), ('os2'); INSERT INTO "atividades_os" VALUES ('a1');`);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente
    // CHAT-1 acrescentou à tabela a leitura (lida_em, lida_por_id) e dois índices: a produção roda os dois arquivos, em ordem
    psql(["-f", path.join(RAIZ, "prisma/sql/2027-02-20_chat_1.sql")]);
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("as duas tabelas são IDÊNTICAS às do Prisma: colunas, tipos, padrões, índices e chaves", () => {
    for (const t of TABELAS) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), t).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), t).toBe(chaves(PRISMA, t));
    }
    expect(colunas(SCHEMA, "os_comentarios").split("\n")).toHaveLength(13);
  });

  it("a chave única (empresa, client_id) impede o comentário reenviado de duplicar; os do escritório (sem client_id) não colidem", () => {
    const ins = (id: string, clientId: string | null) => sql(`INSERT INTO "os_comentarios" ("id", "empresa_id", "ordem_servico_id", "usuario_id", "autor_nome", "origem", "texto", "client_id")
      VALUES ('${id}', 'e1', 'os1', 'u1', 'João', 'APP', 'oi', ${clientId ? `'${clientId}'` : "NULL"}) ON CONFLICT DO NOTHING RETURNING "id"`);
    expect(ins("c1", "k1")).toBe("c1");
    expect(ins("c2", "k1")).toBe("");
    expect(ins("c3", null)).toBe("c3");
    expect(ins("c4", null)).toBe("c4");
  });

  it("uma leitura por pessoa e OS; apagar a OS leva comentários e leituras; apagar a atividade só solta a referência", () => {
    sql(`INSERT INTO "os_comentarios_lidos" VALUES ('u1', 'os1', now())`);
    expect(() => sql(`INSERT INTO "os_comentarios_lidos" VALUES ('u1', 'os1', now())`)).toThrow();
    sql(`INSERT INTO "os_comentarios" ("id", "empresa_id", "ordem_servico_id", "atividade_id", "usuario_id", "autor_nome", "origem", "texto") VALUES ('c9', 'e1', 'os2', 'a1', 'u1', 'João', 'APP', 'x')`);
    sql(`DELETE FROM "atividades_os" WHERE "id" = 'a1'`);
    expect(sql(`SELECT coalesce("atividade_id", '-') FROM "os_comentarios" WHERE "id" = 'c9'`)).toBe("-");
    sql(`DELETE FROM "ordens_servico" WHERE "id" = 'os1'`);
    expect(sql(`SELECT count(*) FROM "os_comentarios" WHERE "ordem_servico_id" = 'os1'`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "os_comentarios_lidos"`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "os_comentarios"`)).toBe("1");
  });

  it("é só aditivo: duas tabelas, numa transação, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN, sem tocar outra tabela", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
    expect(fonte).not.toMatch(/ADD COLUMN/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte.replace(/ON DELETE (CASCADE|SET NULL) ON UPDATE CASCADE/g, "")).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual(TABELAS);
  });

  it("o schema do Prisma aponta para as mesmas tabelas", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model OsComentario \{[\s\S]*?@@unique\(\[empresaId, clientId\]\)[\s\S]*?@@map\("os_comentarios"\)/);
    expect(schema).toMatch(/model OsComentarioLeitura \{[\s\S]*?@@id\(\[usuarioId, ordemServicoId\]\)[\s\S]*?@@map\("os_comentarios_lidos"\)/);
  });
});
