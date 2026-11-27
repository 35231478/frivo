/**
 * Materiais usados em campo — o SQL de produção (prisma/sql/2027-02-01_app_materiais_campo.sql) rodado de verdade num
 * PostgreSQL descartável: cria UMA tabela ("atividade_materiais"), é idempotente (roda duas vezes), não mexe em mais
 * nada, e o resultado é EXATAMENTE o que o Prisma espera (comparado com o schema.prisma aplicado por `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-app-materiais-campo
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-01_app_materiais_campo.sql");
const SCHEMA = `teste_mat_campo_${process.pid}`;
const PRISMA = `teste_mat_campo_prisma_${process.pid}`;
const TABELA = "atividade_materiais";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const colunas = (schema: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(numeric_precision::text, '-') || ',' || coalesce(numeric_scale::text, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${TABELA}' ORDER BY column_name`);
const indices = (schema: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${TABELA}' ORDER BY indexname`);
const chaves = (schema: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${TABELA}'::regclass ORDER BY conname`);

describe.skipIf(!URL)("SQL de produção: materiais usados em campo (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    // Só as tabelas que as chaves estrangeiras apontam (como existem em produção)
    sql(`
      CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY); CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY); CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY); CREATE TABLE "os_materiais" ("id" TEXT PRIMARY KEY);
      INSERT INTO "ordens_servico" VALUES ('os1'); INSERT INTO "atividades_os" VALUES ('a1'), ('a2');
      INSERT INTO "equipamentos" VALUES ('eq1'); INSERT INTO "produtos" VALUES ('p1'); INSERT INTO "os_materiais" VALUES ('m1');
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente, não pode falhar
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("a tabela é IDÊNTICA à que o Prisma espera: colunas, tipos, precisão, padrões, índices e chaves", () => {
    expect(colunas(SCHEMA)).toBe(colunas(PRISMA));
    expect(colunas(SCHEMA).split("\n")).toHaveLength(20);
    expect(indices(SCHEMA)).toBe(indices(PRISMA));
    expect(chaves(SCHEMA)).toBe(chaves(PRISMA));
  });

  const inserir = (id: string, clientId: string, extra = "") => sql(`INSERT INTO "${TABELA}" ("id", "empresa_id", "ordem_servico_id", "atividade_id", "descricao", "quantidade", "client_id", "atualizado_em"${extra ? ", " + extra.split("=")[0] : ""})
    VALUES ('${id}', 'e1', 'os1', 'a1', 'Capacitor', 2.5, '${clientId}', now()${extra ? ", " + extra.split("=")[1] : ""}) ON CONFLICT DO NOTHING RETURNING "id"`);

  it("a chave única (empresa, client_id) é o que impede a mesma gravação do aparelho de duplicar", () => {
    expect(inserir("l1", "c1")).toBe("l1");
    expect(inserir("l2", "c1")).toBe("");
    expect(inserir("l3", "c2")).toBe("l3");
    expect(sql(`SELECT "unidade" || '|' || "baixado" || '|' || "quantidade" FROM "${TABELA}" WHERE "id" = 'l1'`)).toBe("un|0.000|2.500");
  });

  it("apagar a atividade leva as linhas dela; produto, equipamento e separação apagados só soltam a referência", () => {
    sql(`INSERT INTO "${TABELA}" ("id", "empresa_id", "ordem_servico_id", "atividade_id", "equipamento_id", "produto_id", "os_material_id", "descricao", "quantidade", "client_id", "atualizado_em")
      VALUES ('l9', 'e1', 'os1', 'a2', 'eq1', 'p1', 'm1', 'Gás', 1, 'c9', now())`);
    sql(`DELETE FROM "produtos" WHERE "id" = 'p1'; DELETE FROM "equipamentos" WHERE "id" = 'eq1'; DELETE FROM "os_materiais" WHERE "id" = 'm1';`);
    expect(sql(`SELECT coalesce("produto_id", '-') || coalesce("equipamento_id", '-') || coalesce("os_material_id", '-') FROM "${TABELA}" WHERE "id" = 'l9'`)).toBe("---");
    sql(`DELETE FROM "atividades_os" WHERE "id" = 'a2'`);
    expect(sql(`SELECT count(*) FROM "${TABELA}" WHERE "id" = 'l9'`)).toBe("0");
    expect(Number(sql(`SELECT count(*) FROM "${TABELA}"`))).toBeGreaterThan(0);
  });

  it("é só aditivo: uma tabela nova, numa transação, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN, sem tocar outra tabela", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(fonte).toMatch(/CREATE TABLE IF NOT EXISTS "atividade_materiais"/);
    expect(fonte).not.toMatch(/ADD COLUMN/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte.replace(/ON DELETE (CASCADE|SET NULL) ON UPDATE CASCADE/g, "")).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))]).toEqual(["atividade_materiais"]);
    expect(fonte.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g)).toHaveLength(5);
    expect(fonte.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g)).toHaveLength(5);
  });

  it("o schema do Prisma aponta para a mesma tabela", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model AtividadeMaterial \{[\s\S]*?@@unique\(\[empresaId, clientId\]\)[\s\S]*?@@map\("atividade_materiais"\)/);
  });
});
