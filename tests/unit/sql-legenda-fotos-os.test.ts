/**
 * Legenda editável das fotos da OS — o SQL de produção (prisma/sql/2027-02-10_legenda_fotos_os.sql) rodado de verdade
 * num PostgreSQL descartável: só ACRESCENTA a coluna `legenda` nas fotos da execução e dos serviços adicionais,
 * idempotente (roda duas vezes), não muda nenhuma linha que já existe, e a coluna é EXATAMENTE a que o Prisma espera.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-legenda-fotos-os
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-10_legenda_fotos_os.sql");
const SCHEMA = `teste_legenda_${process.pid}`;
const PRISMA = `teste_legenda_prisma_${process.pid}`;
const TABELAS = ["fotos_atendimento", "servicos_adicionais_fotos"];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const colunas = (schema: string, t: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${t}' ORDER BY column_name`);

describe.skipIf(!URL)("SQL de produção: legenda das fotos da OS (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    // O banco como está em produção: as duas tabelas do Prisma SEM a coluna nova, e com fotos dentro
    const url = (s: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${s}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url(PRISMA) }, stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url(SCHEMA) }, stdio: "pipe" });
    sql(`ALTER TABLE "fotos_atendimento" DROP COLUMN "legenda"; ALTER TABLE "servicos_adicionais_fotos" DROP COLUMN "legenda";
      SET session_replication_role = replica;
      INSERT INTO "fotos_atendimento" ("id", "empresa_id", "atividade_id", "equipamento_id", "url", "momento") VALUES ('f1', 'e1', 'a1', 'q1', 'data:x', 'ANTES');
      INSERT INTO "servicos_adicionais_fotos" ("id", "empresa_id", "servico_id", "url") VALUES ('s1', 'e1', 'sv1', 'data:y');`);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("as duas tabelas ficam IDÊNTICAS às do Prisma (a coluna nova: texto, opcional, sem padrão)", () => {
    for (const t of TABELAS) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(colunas(SCHEMA, t).split("\n"), t).toContain("legenda text YES -");
    }
  });

  it("as fotos que já existiam continuam iguais, com a legenda nula (a do sistema continua valendo)", () => {
    expect(sql(`SELECT id || ' ' || momento || ' ' || coalesce(legenda, 'NULA') FROM "fotos_atendimento"`)).toBe("f1 ANTES NULA");
    expect(sql(`SELECT id || ' ' || url || ' ' || coalesce(legenda, 'NULA') FROM "servicos_adicionais_fotos"`)).toBe("s1 data:y NULA");
  });

  it("o arquivo só acrescenta (nada de DROP, DELETE, UPDATE, NOT NULL ou padrão)", () => {
    const comandos = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.startsWith("--") && l.trim());
    expect(comandos).toEqual([
      'ALTER TABLE "fotos_atendimento" ADD COLUMN IF NOT EXISTS "legenda" TEXT;',
      'ALTER TABLE "servicos_adicionais_fotos" ADD COLUMN IF NOT EXISTS "legenda" TEXT;',
    ]);
  });
});
