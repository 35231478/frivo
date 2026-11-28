/**
 * CHAT-1.2 — o SQL de produção (prisma/sql/2027-03-01_chat_1_2_presenca.sql) rodado de verdade num PostgreSQL
 * descartável, a partir do banco como está hoje (sem a coluna nova), com linhas dentro:
 *  - idempotente (roda duas vezes);
 *  - a tabela fica EXATAMENTE como o Prisma espera: colunas, tipos, padrões, índices e chaves;
 *  - os usuários que já existiam não mudam (a coluna nova fica nula);
 *  - nada de DROP/DELETE/UPDATE, nem mexer em coluna existente, nem em perfis de acesso.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-chat-1-2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-03-01_chat_1_2_presenca.sql");
const SCHEMA = `teste_sql_chat12_${process.pid}`;
const PRISMA = `teste_sql_chat12_prisma_${process.pid}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const colunas = (schema: string, t: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || replace(coalesce(column_default, '-'), '${schema}.', '')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${t}' ORDER BY column_name`);
const indices = (schema: string, t: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${t}' ORDER BY indexname`);
const chaves = (schema: string, t: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${t}'::regclass ORDER BY conname`);
const push = (schema: string) => execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
  cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}` }, stdio: "pipe",
});

describe.skipIf(!URL)("SQL de produção: CHAT-1.2 presença (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    push(PRISMA);
    // O banco de hoje: o Prisma sem a coluna nova, com um usuário dentro
    push(SCHEMA);
    sql(`ALTER TABLE "usuarios" DROP COLUMN "ultimo_contato_em";
      SET session_replication_role = replica;
      INSERT INTO "usuarios" ("id", "empresa_id", "nome", "email", "senha", "role", "atualizado_em") VALUES ('u1', 'e1', 'Técnico Exemplo', 'tecnico@exemplo.test', 'x', 'TECNICO', now());`);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente
  }, 240_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("a tabela fica IDÊNTICA à do Prisma: colunas, tipos, padrões, índices e chaves", () => {
    expect(colunas(SCHEMA, "usuarios")).toBe(colunas(PRISMA, "usuarios"));
    expect(indices(SCHEMA, "usuarios")).toBe(indices(PRISMA, "usuarios"));
    expect(chaves(SCHEMA, "usuarios")).toBe(chaves(PRISMA, "usuarios"));
  });

  it("o usuário que já existia continua igual, com o contato nulo (nada aparece até o app falar com o servidor)", () => {
    expect(sql(`SELECT nome || ' ' || coalesce(ultimo_contato_em::text, 'NULO') FROM "usuarios" WHERE id = 'u1'`)).toBe("Técnico Exemplo NULO");
  });

  it("o arquivo só acrescenta: nada de DROP, DELETE, UPDATE, ALTER COLUMN nem perfis de acesso", () => {
    const comandos = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(comandos).not.toMatch(/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im);
    expect(comandos).not.toMatch(/\b(DROP (TABLE|COLUMN|INDEX)|DELETE FROM|UPDATE "|TRUNCATE|ALTER COLUMN)\b/i);
    expect(comandos).not.toMatch(/perfis_acesso|permissoes/i);
    expect(comandos.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(1);
  });
});
