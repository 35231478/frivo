/**
 * Faturamento parcial (P5) — o SQL de produção rodado de verdade num PostgreSQL, numa transação só, TRÊS
 * vezes, num schema descartável com `medicoes` como está hoje:
 *  - `fatura_parcial` boolean NOT NULL DEFAULT false e `percentual_faturado` DECIMAL(6,2) nulo;
 *  - nenhuma medição existente muda (todas ficam "não parcial", sem percentual);
 *  - 2ª e 3ª rodadas não mudam nada (IF NOT EXISTS).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-faturamento-parcial
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-08_faturamento_parcial.sql");
const SCHEMA = `teste_fat_parcial_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const coluna = (col: string) =>
  sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') || ':' || COALESCE(numeric_precision::text, '') || ',' || COALESCE(numeric_scale::text, '') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'medicoes' AND column_name = '${col}'`);
const dados = () => sql(`SELECT string_agg(numero || '|' || status || '|' || valor_liquido || '|' || fatura_parcial || '|' || COALESCE(percentual_faturado::text, '-'), ',' ORDER BY id) FROM medicoes`);

describe.skipIf(!URL)("SQL de produção: faturamento parcial (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "medicoes" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" TEXT NOT NULL, "valor_liquido" DECIMAL(12,2) NOT NULL, "avulsa" BOOLEAN NOT NULL DEFAULT false);
      INSERT INTO "medicoes" VALUES ('m1', 'MED-2026-0001', 'PAGO', 1000.00, false), ('m2', 'MED-2026-0002', 'PC_RECEBIDO', 350.50, true);
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("colunas novas: fatura_parcial false por padrão (obrigatória), percentual_faturado nulo com 2 casas; dados antigos idênticos", () => {
    expect(coluna("fatura_parcial")).toBe("boolean:NO:false:,");
    expect(coluna("percentual_faturado")).toBe("numeric:YES:-:6,2");
    expect(dados()).toBe("MED-2026-0001|PAGO|1000.00|false|-,MED-2026-0002|PC_RECEBIDO|350.50|false|-");
  });

  it("grava uma parte: 40,00% e arredonda a 2 casas; percentual acima de 9999,99 não cabe (precisão 6,2)", () => {
    sql(`INSERT INTO medicoes (id, numero, status, valor_liquido, avulsa, fatura_parcial, percentual_faturado) VALUES ('m3', 'MED-2026-0003', 'PC_RECEBIDO', 400, true, true, 40), ('m4', 'MED-2026-0004', 'PC_RECEBIDO', 333.33, true, true, 33.333)`);
    expect(sql(`SELECT percentual_faturado FROM medicoes WHERE id IN ('m3', 'm4') ORDER BY id`)).toBe("40.00\n33.33");
    expect(() => sql(`INSERT INTO medicoes (id, numero, status, valor_liquido, percentual_faturado) VALUES ('m5', 'x', 'x', 1, 10000)`)).toThrow(/numeric field overflow/);
  });

  it("rodar de novo (2ª e 3ª vez) não muda nada", () => {
    const antes = dados();
    rodar(); rodar();
    expect(dados()).toBe(antes);
    expect(coluna("fatura_parcial")).toBe("boolean:NO:false:,");
    expect(coluna("percentual_faturado")).toBe("numeric:YES:-:6,2");
  });
});
