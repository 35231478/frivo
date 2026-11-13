/**
 * "O que levar" — o SQL de produção (prisma/sql/2027-01-02_app_o_que_levar.sql) rodado de verdade num
 * PostgreSQL descartável: adiciona UMA coluna em "configuracoes", é idempotente (roda três vezes),
 * não mexe em mais nada, e a coluna é EXATAMENTE a que o Prisma espera (comparada com o
 * schema.prisma aplicado por `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-app-o-que-levar
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-02_app_o_que_levar.sql");
const SCHEMA = `teste_o_que_levar_${process.pid}`;
const PRISMA = `teste_o_que_levar_prisma_${process.pid}`;
vi.setConfig({ testTimeout: 60_000 });

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const coluna = (schema: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || column_default FROM information_schema.columns
  WHERE table_schema = '${schema}' AND table_name = 'configuracoes' AND column_name = 'app_o_que_levar'`);
const retrato = () => sql(`SELECT (SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}')
  || ' # ' || (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND column_name <> 'app_o_que_levar')
  || ' # ' || (SELECT string_agg(id || ':' || quantidade, ',' ORDER BY id) FROM "os_materiais")`);

describe.skipIf(!URL)("SQL de produção: opção 'O que levar' do app do técnico (PostgreSQL real)", () => {
  let antes = "";
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    sql(`
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE, "app_avisar_cliente" BOOLEAN NOT NULL DEFAULT true, "app_esconder_valores" BOOLEAN NOT NULL DEFAULT true);
      INSERT INTO "configuracoes" VALUES ('c1', 'e1', false, true), ('c2', 'e2', true, false);   -- duas empresas já cadastradas, cada uma com as suas opções
      CREATE TABLE "os_materiais" ("id" TEXT PRIMARY KEY, "quantidade" DECIMAL(12,3) NOT NULL);
      INSERT INTO "os_materiais" VALUES ('m1', 2), ('m2', 0.5);
    `);
    antes = retrato();
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente, não pode falhar
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("a opção: boolean NOT NULL com DEFAULT true — toda empresa já cadastrada começa LIGADA", () => {
    expect(coluna(SCHEMA)).toBe("boolean:NO:true");
    expect(sql(`SELECT string_agg("id" || '=' || "app_o_que_levar", ',' ORDER BY "id") FROM "configuracoes"`)).toBe("c1=true,c2=true");
  });

  it("a coluna é exatamente a que o Prisma cria a partir do schema.prisma", () => {
    expect(coluna(SCHEMA)).toBe(coluna(PRISMA));
  });

  it("empresa nova (linha criada depois) também nasce ligada", () => {
    sql(`INSERT INTO "configuracoes" ("id", "empresa_id") VALUES ('c3', 'e3')`);
    expect(sql(`SELECT "app_o_que_levar" FROM "configuracoes" WHERE "id" = 'c3'`)).toBe("t");
    sql(`DELETE FROM "configuracoes" WHERE "id" = 'c3'`);
  });

  it("não mexe em mais nada: as outras opções das empresas, as tabelas e os materiais ficam como estavam", () => {
    expect(retrato()).toBe(antes);
    expect(sql(`SELECT string_agg("id" || '=' || "app_avisar_cliente" || '/' || "app_esconder_valores", ',' ORDER BY "id") FROM "configuracoes"`)).toBe("c1=false/true,c2=true/false");
  });

  it("rodar de novo não religa o que a empresa desligou", () => {
    sql(`UPDATE "configuracoes" SET "app_o_que_levar" = false WHERE "id" = 'c1'`);
    psql(["-f", ARQUIVO]);
    expect(sql(`SELECT string_agg("id" || '=' || "app_o_que_levar", ',' ORDER BY "id") FROM "configuracoes"`)).toBe("c1=false,c2=true");
  });

  it("é só aditivo: uma coluna, numa transação, sem CREATE/DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte.match(/ADD COLUMN/g)).toHaveLength(1);
    expect(fonte).toMatch(/ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_o_que_levar" BOOLEAN NOT NULL DEFAULT true;/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte).not.toMatch(/\b(CREATE|DROP|DELETE|UPDATE|TRUNCATE|INSERT|ALTER COLUMN)\b/i);
    expect([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1])).toEqual(["configuracoes"]);
  });

  it("o schema do Prisma aponta para a mesma coluna, nascendo ligada", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/appOQueLevar\s+Boolean\s+@default\(true\)\s+@map\("app_o_que_levar"\)/);
  });
});
