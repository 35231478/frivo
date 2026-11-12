/**
 * Contas a Receber — parcelas + baixa parcial: o SQL de produção rodado de verdade num PostgreSQL, numa
 * transação só (como o `prisma db execute`), TRÊS vezes, num schema descartável com as tabelas como
 * estão HOJE:
 *  - status novo PARCELADO no enum (os antigos continuam);
 *  - contas_receber ganha valor_recebido (0, nunca negativo), lancamento_id, parcela_numero/total —
 *    nenhum dado existente muda;
 *  - parcela → lançamento: lançamento com parcelas não pode ser apagado;
 *  - conta_receber_recebimentos: valor > 0; some com a conta; conta bancária/usuário apagados viram nulo;
 *  - 2ª e 3ª rodadas não mudam nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-contas-receber-parcelas
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-18_contas_receber_parcelas.sql");
const SCHEMA = `teste_cr_parcelas_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const coluna = (tabela: string, col: string) =>
  sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${col}'`);
const fotografia = () => sql(`
  SELECT string_agg(id || '|' || status || '|' || valor || '|' || valor_recebido || '|' || COALESCE(lancamento_id, '-') || '|' || COALESCE(parcela_numero::text, '-'), ',' ORDER BY id) FROM contas_receber`)
  + "#" + sql(`SELECT count(*) || '|' || COALESCE(sum(valor), 0) FROM conta_receber_recebimentos`)
  + "#" + sql(`SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'StatusContaReceber' AND n.nspname = '${SCHEMA}'`)
  + "#" + sql(`SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace`);

describe.skipIf(!URL)("SQL de produção: parcelas e baixa parcial de contas a receber (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TYPE "StatusContaReceber" AS ENUM ('PREVISTO', 'A_RECEBER', 'RECEBIDO', 'CANCELADO', 'ATRASADO');
      CREATE TYPE "FormaPagamento" AS ENUM ('BOLETO', 'PIX', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO', 'CHEQUE');
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contas_bancarias" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contas_receber" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "valor" DECIMAL(12,2) NOT NULL,
        "status" "StatusContaReceber" NOT NULL DEFAULT 'PREVISTO');
      INSERT INTO "empresas" VALUES ('e1');
      INSERT INTO "usuarios" VALUES ('u1');
      INSERT INTO "contas_bancarias" VALUES ('cb1');
      INSERT INTO "contas_receber" VALUES ('cr1', 'CR-1', 1000, 'A_RECEBER'), ('cr2', 'CR-2', 250.5, 'RECEBIDO');
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("enum ganha PARCELADO (os antigos ficam); colunas novas: recebido 0 e não nulo, parcela/lançamento nulos; nada muda nos dados", () => {
    expect(sql(`SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'StatusContaReceber' AND n.nspname = '${SCHEMA}'`))
      .toBe("PREVISTO,A_RECEBER,RECEBIDO,CANCELADO,ATRASADO,PARCELADO");
    expect(coluna("contas_receber", "valor_recebido")).toBe("numeric:NO:0");
    expect(coluna("contas_receber", "lancamento_id")).toBe("text:YES:-");
    for (const c of ["parcela_numero", "parcela_total"]) expect(coluna("contas_receber", c)).toBe("integer:YES:-");
    expect(sql(`SELECT string_agg(id || '|' || valor || '|' || status || '|' || valor_recebido, ',' ORDER BY id) FROM contas_receber`))
      .toBe("cr1|1000.00|A_RECEBER|0.00,cr2|250.50|RECEBIDO|0.00");
  });

  it("recebido nunca negativo; recebimento de valor zero/negativo é recusado", () => {
    expect(falha(`UPDATE contas_receber SET valor_recebido = -1 WHERE id = 'cr1'`)).toContain("contas_receber_valor_recebido_check");
    expect(falha(`INSERT INTO conta_receber_recebimentos (id, empresa_id, conta_receber_id, valor, data) VALUES ('x', 'e1', 'cr1', 0, now())`)).toContain("conta_receber_recebimentos_valor_check");
  });

  it("parcela → lançamento: lançamento inexistente recusado; lançamento com parcelas não pode ser apagado", () => {
    expect(falha(`INSERT INTO contas_receber (id, numero, valor, lancamento_id) VALUES ('p0', 'CR-9/1', 1, 'nao')`)).toContain("contas_receber_lancamento_id_fkey");
    sql(`INSERT INTO contas_receber (id, numero, valor, status, lancamento_id, parcela_numero, parcela_total) VALUES
      ('p1', 'CR-1/1', 500, 'A_RECEBER', 'cr1', 1, 2), ('p2', 'CR-1/2', 500, 'A_RECEBER', 'cr1', 2, 2)`);
    sql(`UPDATE contas_receber SET status = 'PARCELADO', parcela_total = 2 WHERE id = 'cr1'`);
    expect(falha(`DELETE FROM contas_receber WHERE id = 'cr1'`)).toContain("contas_receber_lancamento_id_fkey");
    expect(sql(`SELECT count(*) FROM contas_receber WHERE lancamento_id = 'cr1'`)).toBe("2");
  });

  it("recebimentos: conta inexistente recusada; somem com a conta; conta bancária/usuário apagados viram nulo", () => {
    expect(falha(`INSERT INTO conta_receber_recebimentos (id, empresa_id, conta_receber_id, valor, data) VALUES ('x', 'e1', 'nao', 1, now())`)).toContain("conta_receber_recebimentos_conta_receber_id_fkey");
    expect(falha(`INSERT INTO conta_receber_recebimentos (id, empresa_id, conta_receber_id, valor, data) VALUES ('x', 'nao', 'p1', 1, now())`)).toContain("conta_receber_recebimentos_empresa_id_fkey");
    sql(`INSERT INTO conta_receber_recebimentos (id, empresa_id, conta_receber_id, valor, data, forma_pagamento, conta_bancaria_id, usuario_id)
      VALUES ('r1', 'e1', 'p1', 200, now(), 'PIX', 'cb1', 'u1'), ('r2', 'e1', 'p2', 50, now(), NULL, NULL, NULL)`);
    expect(sql(`SELECT origem FROM conta_receber_recebimentos WHERE id = 'r1'`)).toBe("MANUAL");
    sql(`DELETE FROM contas_bancarias WHERE id = 'cb1'; DELETE FROM usuarios WHERE id = 'u1';`);
    expect(sql(`SELECT COALESCE(conta_bancaria_id, 'null') || '|' || COALESCE(usuario_id, 'null') || '|' || valor FROM conta_receber_recebimentos WHERE id = 'r1'`)).toBe("null|null|200.00");
    sql(`DELETE FROM contas_receber WHERE id = 'p2'`);
    expect(sql(`SELECT count(*) FROM conta_receber_recebimentos WHERE id = 'r2'`)).toBe("0");
  });

  it("idempotente: a 2ª e a 3ª rodadas (com dados novos no meio) não mudam nada", () => {
    const antes = fotografia();
    rodar();
    rodar();
    expect(fotografia()).toBe(antes);
  });
});
