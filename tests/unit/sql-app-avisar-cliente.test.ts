/**
 * Aviso ao cliente (a caminho / cheguei) — o SQL de produção (prisma/sql/2026-12-06_app_avisar_cliente.sql)
 * rodado de verdade num PostgreSQL descartável: adiciona UMA coluna em "configuracoes" e cria UMA
 * tabela ("atividade_avisos"), é idempotente (roda duas vezes), não mexe em mais nada, e o resultado
 * é EXATAMENTE o que o Prisma espera (comparado com o schema.prisma aplicado por `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-app-avisar-cliente
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-06_app_avisar_cliente.sql");
const SCHEMA = `teste_app_avisar_${process.pid}`;
const PRISMA = `teste_app_avisar_prisma_${process.pid}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);

const colunas = (schema: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'atividade_avisos' ORDER BY column_name`);
const indices = (schema: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = 'atividade_avisos' ORDER BY indexname`);
const chaves = (schema: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.atividade_avisos'::regclass ORDER BY conname`);

describe.skipIf(!URL)("SQL de produção: avisar o cliente — a caminho / cheguei (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    sql(`
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE, "app_cadastrar_equipamento" BOOLEAN NOT NULL DEFAULT true);
      INSERT INTO "configuracoes" VALUES ('c1', 'e1', false);   -- empresa já cadastrada, com outra permissão já mexida
      CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "titulo" TEXT NOT NULL);
      INSERT INTO "atividades_os" VALUES ('a1', 'Preventiva'), ('a2', 'Corretiva');
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente, não pode falhar
    // O que o Prisma criaria a partir do schema.prisma (a referência)
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("a permissão: boolean NOT NULL com DEFAULT true — empresa já cadastrada começa LIGADA e o que ela tinha não muda", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable || ':' || column_default FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = 'configuracoes' AND column_name = 'app_avisar_cliente'`)).toBe("boolean:NO:true");
    expect(sql(`SELECT "app_avisar_cliente" || '|' || "app_cadastrar_equipamento" FROM "configuracoes" WHERE "id" = 'c1'`)).toBe("true|false");
  });

  it("rodar de novo não religa o que a empresa desligou", () => {
    sql(`UPDATE "configuracoes" SET "app_avisar_cliente" = false WHERE "id" = 'c1'`);
    psql(["-f", ARQUIVO]);
    expect(sql(`SELECT "app_avisar_cliente" FROM "configuracoes" WHERE "id" = 'c1'`)).toBe("f");
  });

  it("a tabela nova é IDÊNTICA à que o Prisma espera: colunas, tipos, padrões, índices e chaves", () => {
    expect(colunas(SCHEMA)).toBe(colunas(PRISMA));
    expect(colunas(SCHEMA).split("\n")).toHaveLength(12);
    expect(indices(SCHEMA)).toBe(indices(PRISMA));
    expect(chaves(SCHEMA)).toBe(chaves(PRISMA));
    // E a coluna da permissão também bate com a do Prisma
    const col = (schema: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || column_default FROM information_schema.columns
      WHERE table_schema = '${schema}' AND table_name = 'configuracoes' AND column_name = 'app_avisar_cliente'`);
    expect(col(SCHEMA)).toBe(col(PRISMA));
  });

  it("a chave única (atividade, evento, dia) é o que impede o segundo aviso; outro dia ou outro evento passam", () => {
    const inserir = (id: string, evento: string, dia: string) => sql(`INSERT INTO "atividade_avisos" ("id", "empresa_id", "atividade_id", "evento", "dia", "registrado_em", "usuario_id")
      VALUES ('${id}', 'e1', 'a1', '${evento}', '${dia}', now(), 'u1') ON CONFLICT DO NOTHING RETURNING "id"`);
    expect(inserir("x1", "A_CAMINHO", "2026-11-12")).toBe("x1");
    expect(inserir("x2", "A_CAMINHO", "2026-11-12")).toBe("");      // mesmo toque de novo: não entra
    expect(inserir("x3", "CHEGOU", "2026-11-12")).toBe("x3");
    expect(inserir("x4", "A_CAMINHO", "2026-11-13")).toBe("x4");
    expect(sql(`SELECT "aviso_status" FROM "atividade_avisos" WHERE "id" = 'x1'`)).toBe("PENDENTE"); // padrão
  });

  it("apagar a atividade leva os avisos dela (ON DELETE CASCADE); as outras ficam", () => {
    sql(`INSERT INTO "atividade_avisos" ("id", "empresa_id", "atividade_id", "evento", "dia", "registrado_em", "usuario_id") VALUES ('y1', 'e1', 'a2', 'CHEGOU', '2026-11-12', now(), 'u1')`);
    sql(`DELETE FROM "atividades_os" WHERE "id" = 'a2'`);
    expect(sql(`SELECT count(*) FROM "atividade_avisos" WHERE "atividade_id" = 'a2'`)).toBe("0");
    expect(Number(sql(`SELECT count(*) FROM "atividade_avisos" WHERE "atividade_id" = 'a1'`))).toBeGreaterThan(0);
  });

  it("é só aditivo: uma coluna e uma tabela, numa transação, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte.match(/ADD COLUMN/g)).toHaveLength(1);
    expect(fonte).toMatch(/ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_avisar_cliente" BOOLEAN NOT NULL DEFAULT true/);
    expect(fonte.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(fonte).toMatch(/CREATE TABLE IF NOT EXISTS "atividade_avisos"/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte.replace(/ON DELETE CASCADE ON UPDATE CASCADE/g, "")).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
    // As únicas tabelas tocadas: a de configurações (coluna nova) e a tabela nova
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual(["atividade_avisos", "configuracoes"]);
  });

  it("o schema do Prisma aponta para a mesma coluna e a mesma tabela", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/appAvisarCliente\s+Boolean\s+@default\(true\)\s+@map\("app_avisar_cliente"\)/);
    expect(schema).toMatch(/model AtividadeAviso \{[\s\S]*?@@unique\(\[atividadeId, evento, dia\]\)[\s\S]*?@@map\("atividade_avisos"\)/);
  });
});
