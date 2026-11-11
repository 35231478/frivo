/**
 * Cadastro de equipamento em campo — o SQL de produção (prisma/sql/2026-12-04_app_cadastrar_equipamento.sql)
 * rodado de verdade num PostgreSQL descartável: adiciona UMA coluna em "configuracoes", é idempotente
 * (roda duas vezes), não mexe em mais nada e as empresas já cadastradas começam com a permissão LIGADA.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-app-cadastrar-equipamento
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-12-04_app_cadastrar_equipamento.sql");
const SCHEMA = `teste_app_cad_equip_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);

describe.skipIf(!URL)("SQL de produção: permitir cadastrar equipamento em campo (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE, "app_um_dispositivo" BOOLEAN NOT NULL DEFAULT true);
      INSERT INTO "configuracoes" VALUES ('c1', 'e1', false);   -- empresa já cadastrada, com outra permissão já mexida
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente, não pode falhar
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("a coluna existe: boolean NOT NULL com DEFAULT true", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable || ':' || column_default FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = 'configuracoes' AND column_name = 'app_cadastrar_equipamento'`)).toBe("boolean:NO:true");
  });

  it("empresa já cadastrada começa com a permissão LIGADA; o que ela já tinha não muda", () => {
    expect(sql(`SELECT "app_cadastrar_equipamento" || '|' || "app_um_dispositivo" FROM "configuracoes" WHERE "id" = 'c1'`)).toBe("true|false");
  });

  it("empresa nova (linha criada depois) também nasce LIGADA; dá para desligar", () => {
    sql(`INSERT INTO "configuracoes" ("id", "empresa_id") VALUES ('c2', 'e2')`);
    expect(sql(`SELECT "app_cadastrar_equipamento" FROM "configuracoes" WHERE "id" = 'c2'`)).toBe("t");
    sql(`UPDATE "configuracoes" SET "app_cadastrar_equipamento" = false WHERE "id" = 'c2'`);
    psql(["-f", ARQUIVO]); // rodar de novo não religa o que a empresa desligou
    expect(sql(`SELECT "app_cadastrar_equipamento" FROM "configuracoes" WHERE "id" = 'c2'`)).toBe("f");
  });

  it("é só aditivo: uma coluna, numa transação, sem DROP/DELETE/UPDATE/ALTER de coluna existente", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(fonte).toMatch(/ADD COLUMN IF NOT EXISTS "app_cadastrar_equipamento" BOOLEAN NOT NULL DEFAULT true/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(fonte).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
  });

  it("o schema do Prisma aponta para a mesma coluna, com o mesmo padrão", () => {
    const schema = fs.readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/appCadastrarEquipamento\s+Boolean\s+@default\(true\)\s+@map\("app_cadastrar_equipamento"\)/);
  });
});
