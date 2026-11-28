/**
 * CHAT-1 — o SQL de produção (prisma/sql/2027-02-20_chat_1.sql) rodado de verdade num PostgreSQL descartável, a
 * partir do banco como está hoje (o Prisma sem o que este SQL cria), com linhas dentro:
 *  - idempotente (roda duas vezes);
 *  - o resultado é EXATAMENTE o que o Prisma espera: colunas, tipos, padrões, índices e chaves;
 *  - as linhas que já existiam não mudam (as colunas novas nascem nulas ou falsas);
 *  - nada de DROP/DELETE/UPDATE nem perfis de acesso.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-chat-1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-20_chat_1.sql");
const SCHEMA = `teste_sql_chat1_${process.pid}`;
const PRISMA = `teste_sql_chat1_prisma_${process.pid}`;
const TABELAS = ["os_comentarios", "os_comentarios_fotos", "conversas_leituras"];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const colunas = (schema: string, t: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || replace(coalesce(column_default, '-'), '${schema}.', '') || ' ' || coalesce(numeric_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${t}' ORDER BY column_name`);
const indices = (schema: string, t: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${t}' ORDER BY indexname`);
const chaves = (schema: string, t: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${t}'::regclass ORDER BY conname`);
const push = (schema: string) => execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
  cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}` }, stdio: "pipe",
});

describe.skipIf(!URL)("SQL de produção: CHAT-1 (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    push(PRISMA);
    // O banco de hoje: o Prisma sem o que este SQL cria, com linhas dentro
    push(SCHEMA);
    sql(`DROP TABLE "os_comentarios_fotos"; DROP TABLE "conversas_leituras";
      DROP INDEX "os_comentarios_empresa_id_criado_em_idx"; DROP INDEX "os_comentarios_empresa_id_lida_em_idx";
      DROP INDEX "os_comentarios_empresa_id_para_usuario_id_criado_em_idx"; DROP INDEX "os_comentarios_empresa_id_usuario_id_criado_em_idx";
      ALTER TABLE "os_comentarios" DROP COLUMN "lida_em", DROP COLUMN "lida_por_id", DROP COLUMN "para_usuario_id";
      ALTER TABLE "os_comentarios" ALTER COLUMN "ordem_servico_id" SET NOT NULL;
      SET session_replication_role = replica;
      INSERT INTO "os_comentarios" ("id", "empresa_id", "ordem_servico_id", "usuario_id", "autor_nome", "origem", "texto", "client_id")
        VALUES ('c1', 'e1', 'os1', 'u1', 'Técnico', 'APP', 'Cheguei.', 'k1');`);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente
  }, 240_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("as tabelas ficam IDÊNTICAS às do Prisma: colunas, tipos, padrões, índices e chaves", () => {
    for (const t of TABELAS) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), t).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), t).toBe(chaves(PRISMA, t));
    }
  });

  it("as linhas que já existiam continuam iguais: a mensagem nasce sem leitura registrada (sem ✓✓)", () => {
    expect(sql(`SELECT texto || ' ' || coalesce(lida_em::text, 'NULO') || ' ' || coalesce(lida_por_id, 'NULO') || ' ' || ordem_servico_id || ' ' || coalesce(para_usuario_id, 'NULO') FROM "os_comentarios" WHERE id = 'c1'`))
      .toBe("Cheguei. NULO NULO os1 NULO");
    // a mensagem sem OS passa a caber (a coluna só RELAXOU)
    sql(`INSERT INTO "os_comentarios" ("id", "empresa_id", "usuario_id", "autor_nome", "origem", "texto", "para_usuario_id") VALUES ('c2', 'e1', 'u2', 'Ana', 'ESCRITORIO', 'Passa no escritório.', 'u1')`);
    expect(sql(`SELECT coalesce(ordem_servico_id, 'SEM OS') FROM "os_comentarios" WHERE id = 'c2'`)).toBe("SEM OS");
  });

  it("o arquivo só acrescenta: nada de DROP, DELETE, UPDATE nem mexer em perfis de acesso", () => {
    const comandos = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(comandos).not.toMatch(/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im);
    expect(comandos).not.toMatch(/\b(DROP (TABLE|COLUMN)|DELETE FROM|UPDATE "|TRUNCATE)\b/i);
    expect(comandos).not.toMatch(/perfis_acesso|permissoes/i);
    expect(comandos.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(3);
    expect(comandos.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
    // a única mudança em coluna existente é RELAXAR o NOT NULL da OS (nenhuma linha muda)
    expect(comandos.match(/ALTER COLUMN/g)).toEqual(["ALTER COLUMN"]);
    expect(comandos).toMatch(/ALTER COLUMN "ordem_servico_id" DROP NOT NULL/);
  });
});
