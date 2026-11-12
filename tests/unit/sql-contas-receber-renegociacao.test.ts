/**
 * Contas a Receber — renegociar: o SQL de produção rodado de verdade num PostgreSQL, numa transação só
 * (como o `prisma db execute`), TRÊS vezes, num schema descartável com as tabelas como estão HOJE:
 *  - status novo RENEGOCIADO no enum (os antigos continuam);
 *  - renegociada_em_id (FK para a própria tabela; apagar a renegociação solta o vínculo; nunca ela mesma);
 *  - juros/multa/desconto nulos, nunca negativos;
 *  - nenhum dado existente muda; 2ª e 3ª rodadas não mudam nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-contas-receber-renegociacao
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-22_contas_receber_renegociacao.sql");
const SCHEMA = `teste_cr_reneg_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const coluna = (col: string) =>
  sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'contas_receber' AND column_name = '${col}'`);
const enumStatus = () => sql(`SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'StatusContaReceber' AND n.nspname = '${SCHEMA}'`);
const fotografia = () => enumStatus()
  + "#" + sql(`SELECT string_agg(id || '|' || status || '|' || valor || '|' || COALESCE(renegociada_em_id, '-') || '|' || COALESCE(renegociacao_juros::text, '-'), ',' ORDER BY id) FROM contas_receber`)
  + "#" + sql(`SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace`)
  + "#" + sql(`SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes WHERE schemaname = '${SCHEMA}'`);

describe.skipIf(!URL)("SQL de produção: renegociação de contas a receber (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TYPE "StatusContaReceber" AS ENUM ('PREVISTO', 'A_RECEBER', 'RECEBIDO', 'CANCELADO', 'ATRASADO', 'PARCELADO', 'PERDA');
      CREATE TABLE "contas_receber" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "valor" DECIMAL(12,2) NOT NULL,
        "status" "StatusContaReceber" NOT NULL DEFAULT 'PREVISTO');
      INSERT INTO "contas_receber" VALUES ('cr1', 'e1', 1000, 'ATRASADO'), ('cr2', 'e1', 300, 'A_RECEBER'), ('cr3', 'e1', 50, 'PERDA');
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("enum ganha RENEGOCIADO (os antigos ficam); colunas novas nulas e sem padrão; nada muda nos dados", () => {
    expect(enumStatus()).toBe("PREVISTO,A_RECEBER,RECEBIDO,CANCELADO,ATRASADO,PARCELADO,PERDA,RENEGOCIADO");
    expect(coluna("renegociada_em_id")).toBe("text:YES:-");
    for (const c of ["renegociacao_juros", "renegociacao_multa", "renegociacao_desconto"]) expect(coluna(c)).toBe("numeric:YES:-");
    expect(sql(`SELECT string_agg(id || '|' || valor || '|' || status, ',' ORDER BY id) FROM contas_receber`)).toBe("cr1|1000.00|ATRASADO,cr2|300.00|A_RECEBER,cr3|50.00|PERDA");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'contas_receber_renegociada_em_id_idx'`)).toBe("1");
  });

  it("vínculo: só para conta que existe; nunca ela mesma; apagar a renegociação solta o vínculo (a original fica)", () => {
    expect(falha(`UPDATE contas_receber SET renegociada_em_id = 'nao' WHERE id = 'cr1'`)).toContain("contas_receber_renegociada_em_id_fkey");
    expect(falha(`UPDATE contas_receber SET renegociada_em_id = 'cr1' WHERE id = 'cr1'`)).toContain("contas_receber_renegociada_em_outra_check");
    sql(`INSERT INTO contas_receber (id, empresa_id, valor, status, renegociacao_juros, renegociacao_multa, renegociacao_desconto) VALUES ('rn', 'e1', 1050, 'A_RECEBER', 30, 20, 0)`);
    sql(`UPDATE contas_receber SET status = 'RENEGOCIADO', renegociada_em_id = 'rn' WHERE id = 'cr1'`);
    expect(sql(`SELECT status || '|' || renegociada_em_id FROM contas_receber WHERE id = 'cr1'`)).toBe("RENEGOCIADO|rn");
    sql(`DELETE FROM contas_receber WHERE id = 'rn'`);
    expect(sql(`SELECT status || '|' || COALESCE(renegociada_em_id, 'null') FROM contas_receber WHERE id = 'cr1'`)).toBe("RENEGOCIADO|null");
  });

  it("juros, multa e desconto: zero vale, negativo não", () => {
    expect(falha(`UPDATE contas_receber SET renegociacao_juros = 0, renegociacao_multa = 0, renegociacao_desconto = 0 WHERE id = 'cr2'`)).toBe("gravou");
    for (const c of ["renegociacao_juros", "renegociacao_multa", "renegociacao_desconto"]) {
      expect(falha(`UPDATE contas_receber SET ${c} = -0.01 WHERE id = 'cr2'`)).toContain("contas_receber_renegociacao_valores_check");
    }
  });

  it("idempotente: a 2ª e a 3ª rodadas (com dados novos no meio) não mudam nada", () => {
    const antes = fotografia();
    rodar();
    rodar();
    expect(fotografia()).toBe(antes);
  });
});
