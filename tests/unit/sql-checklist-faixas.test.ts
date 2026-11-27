/**
 * Faixa esperada nas medições — o SQL de produção (prisma/sql/2027-02-05_checklist_faixas.sql) rodado de verdade num
 * PostgreSQL descartável: SEIS colunas e UM índice novos, idempotente (roda duas vezes), não mexe nos dados (nenhuma
 * faixa é gravada), e o resultado é EXATAMENTE o que o Prisma espera (comparado com o schema.prisma aplicado por
 * `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-checklist-faixas
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-05_checklist_faixas.sql");
const SCHEMA = `teste_faixas_${process.pid}`;
const PRISMA = `teste_faixas_prisma_${process.pid}`;
const NOVAS: Record<string, string[]> = {
  checklist_tipo_itens: ["grandeza", "valor_min", "valor_max"],
  checklist_respostas: ["faixa_min", "faixa_max", "fora_da_faixa"],
};
const INDICE = "checklist_respostas_empresa_id_fora_da_faixa_respondido_em_idx";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const colunas = (schema: string, t: string, so: string[]) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(numeric_precision::text, '-') || ' ' || coalesce(numeric_scale::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${t}' AND column_name IN (${so.map((c) => `'${c}'`).join(",")}) ORDER BY column_name`);
const indice = (schema: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND indexname = '${INDICE}'`);

describe.skipIf(!URL)("SQL de produção: faixa esperada nas medições (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    // As duas tabelas como estão hoje em produção (só o que o SQL toca), com dados
    sql(`CREATE TABLE "checklist_tipo_itens" ("id" TEXT PRIMARY KEY, "texto" TEXT NOT NULL, "unidade" TEXT);
      CREATE TABLE "checklist_respostas" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "valor" DECIMAL(12,3), "respondido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "checklist_tipo_itens" VALUES ('i1', 'Pressão de sucção', 'psi'), ('i2', 'Limpeza dos filtros', NULL);
      INSERT INTO "checklist_respostas" ("id", "empresa_id", "valor") VALUES ('r1', 'e1', 95), ('r2', 'e1', NULL);`);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("as seis colunas e o índice são IDÊNTICOS aos do Prisma (tipo, nulo, padrão, precisão)", () => {
    for (const [t, cols] of Object.entries(NOVAS)) {
      expect(colunas(SCHEMA, t, cols), t).toBe(colunas(PRISMA, t, cols));
      expect(colunas(SCHEMA, t, cols).split("\n"), t).toHaveLength(3);
    }
    expect(indice(SCHEMA)).toBe(indice(PRISMA));
    expect(indice(SCHEMA)).toContain("(empresa_id, fora_da_faixa, respondido_em)");
  });

  it("não mexe nos dados: os itens ficam sem faixa nem grandeza, as respostas ficam como eram e 'fora' nasce falso", () => {
    expect(sql(`SELECT id || '|' || texto || '|' || coalesce(grandeza, '-') || '|' || coalesce(valor_min::text, '-') || '|' || coalesce(valor_max::text, '-') FROM "checklist_tipo_itens" ORDER BY id`).split("\n"))
      .toEqual(["i1|Pressão de sucção|-|-|-", "i2|Limpeza dos filtros|-|-|-"]);
    expect(sql(`SELECT id || '|' || coalesce(valor::text, '-') || '|' || coalesce(faixa_min::text, '-') || '|' || fora_da_faixa FROM "checklist_respostas" ORDER BY id`).split("\n"))
      .toEqual(["r1|95.000|-|false", "r2|-|-|false"]);
  });

  it("é só aditivo: seis ADD COLUMN IF NOT EXISTS e um CREATE INDEX IF NOT EXISTS, numa transação, nas duas tabelas", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(6);
    expect(fonte.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(1);
    expect(fonte).not.toMatch(/CREATE TABLE|ADD COLUMN (?!IF NOT EXISTS)/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN|INSERT)\b/i);
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual(Object.keys(NOVAS).sort());
  });

  it("o schema do Prisma aponta para as mesmas colunas", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/valorMin\s+Decimal\?\s+@map\("valor_min"\) @db\.Decimal\(12, 3\)/);
    expect(schema).toMatch(/foraDaFaixa\s+Boolean\s+@default\(false\) @map\("fora_da_faixa"\)/);
    expect(schema).toMatch(/@@index\(\[empresaId, foraDaFaixa, respondidoEm\]\)/);
  });
});
