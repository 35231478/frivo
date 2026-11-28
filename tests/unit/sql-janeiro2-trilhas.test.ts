/**
 * App pronto pra janeiro 2 · PR B — o SQL de produção (prisma/sql/2027-02-22_janeiro2_trilhas.sql) rodado de verdade
 * num PostgreSQL descartável: DUAS tabelas novas (a trilha da despesa de campo, D7; a correção do checklist do veículo,
 * D13), idempotente (roda 3×), só aditivo, e IDÊNTICO ao que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-janeiro2-trilhas
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-22_janeiro2_trilhas.sql");
const SCHEMA = `teste_trilhas_${process.pid}`;
const PRISMA = `teste_trilhas_prisma_${process.pid}`;
const VIZINHO = `teste_trilhas_vizinho_${process.pid}`;
const TABELAS = ["despesas_campo_historico", "checklist_correcoes"];

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

describe.skipIf(!URL)("SQL de produção: as trilhas do janeiro 2 (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    // O que já existe em produção e a tabela nova referencia
    sql(`CREATE TABLE "checklist_preenchidos" ("id" TEXT PRIMARY KEY, "observacao_geral" TEXT); INSERT INTO "checklist_preenchidos" VALUES ('c1', 'antes'), ('c2', NULL);`);
    // Um vizinho no MESMO banco já com uma chave de mesmo nome (outro schema): não pode impedir a nossa de nascer
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${VIZINHO} CASCADE; CREATE SCHEMA ${VIZINHO};
      CREATE TABLE ${VIZINHO}.checklist_preenchidos (id TEXT PRIMARY KEY); CREATE TABLE ${VIZINHO}.checklist_correcoes (id TEXT PRIMARY KEY, checklist_id TEXT);
      ALTER TABLE ${VIZINHO}.checklist_correcoes ADD CONSTRAINT checklist_correcoes_checklist_id_fkey FOREIGN KEY (checklist_id) REFERENCES ${VIZINHO}.checklist_preenchidos(id);`]);
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO]); // 3×: idempotente
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE; DROP SCHEMA IF EXISTS ${VIZINHO} CASCADE;`]); });

  it("as duas tabelas são IDÊNTICAS às do Prisma: colunas, tipos, padrões, índices e chaves", () => {
    for (const t of TABELAS) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), t).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), t).toBe(chaves(PRISMA, t));
    }
  });

  it("só aditivo: o que existia ficou igual; nada de DROP, ALTER em coluna existente, UPDATE ou DELETE", () => {
    expect(sql(`SELECT string_agg(id || ':' || coalesce(observacao_geral, '-'), ',' ORDER BY id) FROM "checklist_preenchidos"`)).toBe("c1:antes,c2:-");
    // (o "ON DELETE/UPDATE CASCADE" da chave estrangeira nova não é um comando)
    const texto = fs.readFileSync(ARQUIVO, "utf8").replace(/--.*$/gm, "").replace(/ON (DELETE|UPDATE) CASCADE/g, "");
    expect(texto).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE|RENAME)\b/i);
    expect(texto.match(/ALTER TABLE "([a-z_]+)"/g) ?? []).toEqual(['ALTER TABLE "checklist_correcoes"']);
  });

  it("a correção do checklist: client_id único (o reenvio não aplica duas vezes); apagar o checklist leva a trilha dele", () => {
    const corr = (id: string, c: string, cid: string) => sql(`INSERT INTO "checklist_correcoes" ("id", "empresa_id", "checklist_id", "client_id", "detalhes", "feito_em") VALUES ('${id}', 'e1', '${c}', '${cid}', 'x', now()) ON CONFLICT DO NOTHING RETURNING "id"`);
    expect(corr("k1", "c1", "u1")).toBe("k1");
    expect(corr("k2", "c1", "u1")).toBe("");
    expect(corr("k3", "c2", "u3")).toBe("k3");
    sql(`DELETE FROM "checklist_preenchidos" WHERE "id" = 'c1'`);
    expect(sql(`SELECT string_agg("id", ',') FROM "checklist_correcoes"`)).toBe("k3");
  });

  it("a trilha da despesa fica mesmo sem a despesa (sem chave estrangeira, de propósito)", () => {
    expect(sql(`INSERT INTO "despesas_campo_historico" ("id", "empresa_id", "despesa_id", "client_id", "tecnico_id", "acao", "detalhes") VALUES ('h1', 'e1', 'despesa-que-saiu', 'c', 't1', 'EXCLUIDA', 'Pedágio · R$ 12,50') RETURNING "acao"`)).toBe("EXCLUIDA");
    expect(chaves(SCHEMA, "despesas_campo_historico")).toBe("despesas_campo_historico_pkey PRIMARY KEY (id)");
  });
});
