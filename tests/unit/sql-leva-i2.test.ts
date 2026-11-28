/**
 * Leva I.2 — o SQL de produção (prisma/sql/2027-02-14_leva_i2.sql) rodado de verdade num PostgreSQL descartável, a
 * partir do banco como está hoje (o Prisma sem o que este SQL cria), com linhas dentro:
 *  - idempotente (roda duas vezes);
 *  - o resultado é EXATAMENTE o que o Prisma espera: colunas, tipos, padrões, índices e chaves;
 *  - as linhas que já existiam não mudam (as colunas novas nascem nulas ou falsas);
 *  - nada de DROP/DELETE/UPDATE nem perfis de acesso.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-leva-i2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-14_leva_i2.sql");
const SCHEMA = `teste_sql_leva_i2_${process.pid}`;
const PRISMA = `teste_sql_leva_i2_prisma_${process.pid}`;
const TABELAS = ["empresa_eventos", "tabela_preco_reajustes", "os_itens_orcamento", "notas_compra_descartes"];

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

describe.skipIf(!URL)("SQL de produção: Leva I.2 (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    push(PRISMA);
    // O banco de hoje: o Prisma sem o que este SQL cria, com linhas dentro
    push(SCHEMA);
    sql(`DROP TABLE "empresa_eventos"; DROP TABLE "tabela_preco_reajustes";
      ALTER TABLE "os_itens_orcamento" DROP COLUMN "material_campo_id", DROP COLUMN "conferir_campo", DROP COLUMN "conferido_campo_em", DROP COLUMN "conferido_campo_por_id";
      ALTER TABLE "notas_compra_descartes" DROP COLUMN "xml", DROP COLUMN "restaurada_em", DROP COLUMN "restaurada_por_id", DROP COLUMN "nota_restaurada_id";
      SET session_replication_role = replica;
      INSERT INTO "os_itens_orcamento" ("id", "ordem_servico_id", "descricao", "quantidade", "valor_unitario", "valor_total") VALUES ('i1', 'os1', 'Limpeza', 1, 100, 100);
      INSERT INTO "notas_compra_descartes" ("id", "empresa_id", "nota_id", "chave_acesso", "numero", "serie", "emitente_nome", "emitente_cnpj", "valor_total", "data_emissao", "status_na_hora")
        VALUES ('d1', 'e1', 'n1', '1', '10', '1', 'Fornecedor', '1', 50, now(), 'IMPORTADA');`);
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

  it("as linhas que já existiam continuam iguais: o item nasce sem material de campo e sem conferência; o descarte, sem XML", () => {
    expect(sql(`SELECT coalesce(material_campo_id, 'NULO') || ' ' || conferir_campo FROM "os_itens_orcamento" WHERE id = 'i1'`)).toBe("NULO false");
    expect(sql(`SELECT coalesce(xml, 'NULO') || ' ' || coalesce(restaurada_em::text, 'NULO') FROM "notas_compra_descartes" WHERE id = 'd1'`)).toBe("NULO NULO");
  });

  it("o arquivo só acrescenta: nada de DROP, DELETE, UPDATE nem mexer em perfis de acesso", () => {
    const comandos = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(comandos).not.toMatch(/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im);
    expect(comandos).not.toMatch(/\b(DROP (TABLE|COLUMN)|DELETE FROM|UPDATE "|TRUNCATE)\b/i);
    expect(comandos).not.toMatch(/perfis_acesso|permissoes/i);
    expect(comandos.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(8);
    expect(comandos.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
  });
});
