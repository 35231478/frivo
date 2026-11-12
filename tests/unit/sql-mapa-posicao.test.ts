/**
 * Mapa dos técnicos — o SQL de produção (prisma/sql/2026-12-08_mapa_posicao_tecnicos.sql) rodado de
 * verdade num PostgreSQL descartável: adiciona UMA coluna em "configuracoes" (DESLIGADA por padrão) e
 * cria UMA tabela ("tecnico_posicoes", uma linha por técnico), é idempotente (roda duas vezes), não
 * mexe em mais nada, e o resultado é EXATAMENTE o que o Prisma espera (comparado com o schema.prisma
 * aplicado por `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-mapa-posicao
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-08_mapa_posicao_tecnicos.sql");
const SCHEMA = `teste_mapa_posicao_${process.pid}`;
const PRISMA = `teste_mapa_posicao_prisma_${process.pid}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);

const colunas = (schema: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'tecnico_posicoes' ORDER BY column_name`);
const indices = (schema: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = 'tecnico_posicoes' ORDER BY indexname`);
const chaves = (schema: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.tecnico_posicoes'::regclass ORDER BY conname`);
const permissao = (schema: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || column_default FROM information_schema.columns
  WHERE table_schema = '${schema}' AND table_name = 'configuracoes' AND column_name = 'app_rastrear_localizacao'`);

describe.skipIf(!URL)("SQL de produção: mapa — última posição dos técnicos (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    sql(`
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE, "app_exigir_localizacao" BOOLEAN NOT NULL DEFAULT false);
      INSERT INTO "configuracoes" VALUES ('c1', 'e1', true);   -- empresa já cadastrada, que já exige GPS para usar o app
      CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "latitude" DOUBLE PRECISION, "longitude" DOUBLE PRECISION, "ultima_localizacao" TIMESTAMP(3));
      INSERT INTO "tecnicos" VALUES ('t1', 'Carlos', -23.5, -46.6, '2026-01-01'), ('t2', 'Ana', NULL, NULL, NULL);
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente, não pode falhar
    // O que o Prisma criaria a partir do schema.prisma (a referência)
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("a permissão: boolean NOT NULL com DEFAULT false — empresa já cadastrada começa DESLIGADA (dado sensível) e o que ela tinha não muda", () => {
    expect(permissao(SCHEMA)).toBe("boolean:NO:false");
    // "Exigir localização" é outra chave (trava do app): ligada não significa rastrear
    expect(sql(`SELECT "app_rastrear_localizacao" || '|' || "app_exigir_localizacao" FROM "configuracoes" WHERE "id" = 'c1'`)).toBe("false|true");
  });

  it("rodar de novo não desliga o que a empresa ligou", () => {
    sql(`UPDATE "configuracoes" SET "app_rastrear_localizacao" = true WHERE "id" = 'c1'`);
    psql(["-f", ARQUIVO]);
    expect(sql(`SELECT "app_rastrear_localizacao" FROM "configuracoes" WHERE "id" = 'c1'`)).toBe("t");
  });

  it("a tabela nova é IDÊNTICA à que o Prisma espera: colunas, tipos, padrões, índices e chaves", () => {
    expect(colunas(SCHEMA)).toBe(colunas(PRISMA));
    expect(colunas(SCHEMA).split("\n")).toHaveLength(13);
    expect(indices(SCHEMA)).toBe(indices(PRISMA));
    expect(chaves(SCHEMA)).toBe(chaves(PRISMA));
    expect(permissao(SCHEMA)).toBe(permissao(PRISMA));
  });

  it("UMA linha por técnico: a chave única em tecnico_id recusa a segunda; bateria e precisão podem ficar vazias", () => {
    const inserir = (id: string, tecnico: string) => sql(`INSERT INTO "tecnico_posicoes" ("id", "empresa_id", "tecnico_id", "latitude", "longitude", "registrado_em", "motivo")
      VALUES ('${id}', 'e1', '${tecnico}', -23.55, -46.63, now(), 'ABRIU_APP') ON CONFLICT DO NOTHING RETURNING "id"`);
    expect(inserir("p1", "t1")).toBe("p1");
    expect(inserir("p2", "t1")).toBe("");      // o mesmo técnico de novo: não entra (a última substitui por UPDATE)
    expect(inserir("p3", "t2")).toBe("p3");
    expect(sql(`SELECT coalesce("bateria"::text, 'null') || '|' || coalesce("precisao_m"::text, 'null') || '|' || "origem" FROM "tecnico_posicoes" WHERE "id" = 'p1'`)).toBe("null|null|PWA");
  });

  it("apagar o técnico leva a posição dele (ON DELETE CASCADE); a dos outros fica", () => {
    sql(`DELETE FROM "tecnicos" WHERE "id" = 't2'`);
    expect(sql(`SELECT count(*) FROM "tecnico_posicoes" WHERE "tecnico_id" = 't2'`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "tecnico_posicoes" WHERE "tecnico_id" = 't1'`)).toBe("1");
  });

  it("as colunas antigas de posição no cadastro do técnico (preenchidas à mão) não são tocadas", () => {
    expect(sql(`SELECT "latitude" || '|' || "longitude" || '|' || to_char("ultima_localizacao", 'YYYY-MM-DD') FROM "tecnicos" WHERE "id" = 't1'`)).toBe("-23.5|-46.6|2026-01-01");
  });

  it("é só aditivo: uma coluna e uma tabela, numa transação, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte.match(/ADD COLUMN/g)).toHaveLength(1);
    expect(fonte).toMatch(/ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_rastrear_localizacao" BOOLEAN NOT NULL DEFAULT false/);
    expect(fonte.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(fonte).toMatch(/CREATE TABLE IF NOT EXISTS "tecnico_posicoes"/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte.replace(/ON DELETE CASCADE ON UPDATE CASCADE/g, "")).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
    // As únicas tabelas tocadas: a de configurações (coluna nova) e a tabela nova
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual(["configuracoes", "tecnico_posicoes"]);
  });

  it("o schema do Prisma aponta para a mesma coluna e a mesma tabela", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/appRastrearLocalizacao\s+Boolean\s+@default\(false\)\s+@map\("app_rastrear_localizacao"\)/);
    expect(schema).toMatch(/model TecnicoPosicao \{[\s\S]*?tecnicoId\s+String\s+@unique\s+@map\("tecnico_id"\)[\s\S]*?@@map\("tecnico_posicoes"\)/);
  });
});
