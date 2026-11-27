/**
 * Despesas de campo — o SQL de produção (prisma/sql/2027-02-04_app_despesas_campo.sql) rodado de verdade num
 * PostgreSQL descartável: DUAS colunas e DUAS tabelas novas, idempotente (roda duas vezes), as empresas já cadastradas
 * começam com "Lançar despesas pelo app" LIGADO, e o resultado é EXATAMENTE o que o Prisma espera (comparado com o
 * schema.prisma aplicado por `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-app-despesas-campo
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-04_app_despesas_campo.sql");
const SCHEMA = `teste_desp_${process.pid}`;
const PRISMA = `teste_desp_prisma_${process.pid}`;
const TABELAS = ["despesas_campo", "despesas_campo_fotos"];
const COLUNAS_NOVAS = ["app_lancar_despesas", "despesas_campo_categorias"];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const colunas = (schema: string, t: string, so?: string[]) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(numeric_precision::text, '-') || ' ' || coalesce(numeric_scale::text, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${t}' ${so ? `AND column_name IN (${so.map((c) => `'${c}'`).join(",")})` : ""} ORDER BY column_name`);
const indices = (schema: string, t: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${t}' ORDER BY indexname`);
const chaves = (schema: string, t: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${t}'::regclass ORDER BY conname`);
const despesa = (id: string, clientId: string, extra = "") => `INSERT INTO "despesas_campo" ("id", "empresa_id", "tecnico_id", "usuario_id", "ordem_servico_id", "atividade_id", "categoria", "valor", "data", "pagamento", "client_id", "atualizado_em", "conta_pagar_id")
  VALUES ('${id}', 'e1', 't1', 'u1', 'os1', 'a1', 'COMBUSTIVEL', 187.4, '2026-11-20', 'PROPRIO', '${clientId}', now(), ${extra || "NULL"}) ON CONFLICT DO NOTHING RETURNING "id"`;

describe.skipIf(!URL)("SQL de produção: despesas de campo (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    sql(`CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL); CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY); CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY); CREATE TABLE "contas_pagar" ("id" TEXT PRIMARY KEY);
      INSERT INTO "configuracoes" VALUES ('cfg1', 'e1'); INSERT INTO "tecnicos" VALUES ('t1'), ('t2'); INSERT INTO "ordens_servico" VALUES ('os1');
      INSERT INTO "atividades_os" VALUES ('a1'); INSERT INTO "contas_pagar" VALUES ('cp1'), ('cp2');`);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("as duas tabelas e as duas colunas são IDÊNTICAS às do Prisma: colunas, tipos, padrões, índices e chaves", () => {
    for (const t of TABELAS) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), t).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), t).toBe(chaves(PRISMA, t));
    }
    expect(colunas(SCHEMA, "configuracoes", COLUNAS_NOVAS)).toBe(colunas(PRISMA, "configuracoes", COLUNAS_NOVAS));
    expect(colunas(SCHEMA, "despesas_campo").split("\n")).toHaveLength(19);
  });

  it("a empresa já cadastrada começa com 'Lançar despesas pelo app' LIGADO e sem mapa de categorias", () => {
    expect(sql(`SELECT "app_lancar_despesas" || ' ' || coalesce("despesas_campo_categorias"::text, '-') FROM "configuracoes" WHERE "id" = 'cfg1'`)).toBe("true -");
  });

  it("(empresa, client_id) impede a despesa reenviada de duplicar; uma conta de reembolso por despesa", () => {
    expect(sql(despesa("d1", "k1", "'cp1'"))).toBe("d1");
    expect(sql(despesa("d2", "k1"))).toBe("");
    expect(sql(despesa("d3", "k3", "'cp1'"))).toBe(""); // a mesma conta noutra despesa: não entra
    expect(sql(despesa("d4", "k4", "'cp2'"))).toBe("d4");
    expect(sql(`SELECT "status" FROM "despesas_campo" WHERE "id" = 'd1'`)).toBe("PENDENTE");
  });

  it("apagar a conta, a OS ou a atividade só solta a referência; apagar a despesa leva a foto; apagar o colaborador leva a despesa", () => {
    sql(`INSERT INTO "despesas_campo_fotos" VALUES ('d1', 'data:image/png;base64,xxx')`);
    sql(`DELETE FROM "contas_pagar" WHERE "id" = 'cp1'; DELETE FROM "ordens_servico" WHERE "id" = 'os1'; DELETE FROM "atividades_os" WHERE "id" = 'a1';`);
    expect(sql(`SELECT concat_ws(',', coalesce("conta_pagar_id", '-'), coalesce("ordem_servico_id", '-'), coalesce("atividade_id", '-')) FROM "despesas_campo" WHERE "id" = 'd1'`)).toBe("-,-,-");
    expect(sql(`SELECT count(*) FROM "despesas_campo_fotos"`)).toBe("1");
    sql(`DELETE FROM "tecnicos" WHERE "id" = 't1'`);
    expect(sql(`SELECT count(*) FROM "despesas_campo"`)).toBe("0"); // d1 e d4 eram do t1
    expect(sql(`SELECT count(*) FROM "despesas_campo_fotos"`)).toBe("0");
  });

  it("é só aditivo: duas colunas e duas tabelas, numa transação, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
    expect(fonte.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2);
    expect(fonte).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte.replace(/ON DELETE (CASCADE|SET NULL) ON UPDATE CASCADE/g, "")).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual(["configuracoes", ...TABELAS]);
  });

  it("o schema do Prisma aponta para as mesmas tabelas e colunas", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model DespesaCampo \{[\s\S]*?@@unique\(\[empresaId, clientId\]\)[\s\S]*?@@map\("despesas_campo"\)/);
    expect(schema).toMatch(/model DespesaCampoFoto \{[\s\S]*?@@map\("despesas_campo_fotos"\)/);
    expect(schema).toMatch(/appLancarDespesas\s+Boolean\s+@default\(true\) @map\("app_lancar_despesas"\)/);
  });
});
