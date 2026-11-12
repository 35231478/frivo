/**
 * Contrato recorrente PR2 — serviço padrão do contrato: o SQL de produção rodado de verdade num
 * PostgreSQL, numa transação só (como o `prisma db execute`), TRÊS vezes, num schema descartável com
 * as tabelas como estão HOJE: coluna nova servico_id nula (sem backfill); FK para servicos com
 * SET NULL (apagar o serviço não apaga o contrato); índice; 2ª e 3ª rodadas não mudam nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-contrato-servico-padrao
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-24_contrato_servico_padrao.sql");
const SCHEMA = `teste_contrato_servico_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };

describe.skipIf(!URL)("SQL de produção: serviço padrão do contrato (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "servicos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
      CREATE TABLE "contratos" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "valor_mensal" DECIMAL(10,2));
      INSERT INTO "servicos" VALUES ('s1', 'Manutenção preventiva'), ('s2', 'Limpeza');
      INSERT INTO "contratos" VALUES ('c1', 'CT-1', 1200), ('c2', 'CT-2', NULL);
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("coluna nova TEXT nula, sem padrão; contratos existentes intactos e sem serviço (nada preenchido sozinho)", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'contratos' AND column_name = 'servico_id'`))
      .toBe("text:YES:-");
    expect(sql(`SELECT string_agg(numero || '=' || COALESCE(servico_id, 'null') || ':' || COALESCE(valor_mensal::text, '-'), ',' ORDER BY id) FROM contratos`))
      .toBe("CT-1=null:1200.00,CT-2=null:-");
  });

  it("FK: serviço inexistente é recusado; vários contratos podem usar o mesmo serviço; apagar o serviço NÃO apaga o contrato", () => {
    expect(falha(`UPDATE contratos SET servico_id = 'nao-existe' WHERE id = 'c1'`)).toContain("contratos_servico_id_fkey");
    expect(falha(`UPDATE contratos SET servico_id = 's1'`)).toBe("gravou");
    sql(`DELETE FROM servicos WHERE id = 's1'`);
    expect(sql(`SELECT string_agg(numero || '=' || COALESCE(servico_id, 'null'), ',' ORDER BY id) FROM contratos`)).toBe("CT-1=null,CT-2=null");
    expect(sql(`SELECT count(*) FROM contratos`)).toBe("2");
  });

  it("índice criado; 2ª e 3ª rodadas não mudam nada (dado gravado fica; índice e FK não duplicam)", () => {
    sql(`UPDATE contratos SET servico_id = 's2' WHERE id = 'c2'`);
    rodar();
    rodar();
    expect(sql(`SELECT servico_id FROM contratos WHERE id = 'c2'`)).toBe("s2");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'contratos_servico_id_idx'`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'contratos'::regclass AND conname = 'contratos_servico_id_fkey'`)).toBe("1");
    expect(sql(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'contratos'::regclass AND conname = 'contratos_servico_id_fkey'`)).toBe("n");
  });
});
