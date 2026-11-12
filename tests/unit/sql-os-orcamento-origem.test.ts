/**
 * "Gerar OS" a partir do orçamento — o SQL de produção rodado de verdade num PostgreSQL, numa
 * transação só (como o `prisma db execute`), TRÊS vezes, num schema descartável com as tabelas
 * como estão HOJE: coluna nova orcamento_origem_id nula; ÚNICO (um orçamento gera uma OS só);
 * FK para orcamentos com SET NULL; OS existentes intactas (sem backfill); 2ª e 3ª rodadas: nada muda.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-os-orcamento-origem
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-10_os_orcamento_origem.sql");
const SCHEMA = `teste_os_orcamento_origem_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };

describe.skipIf(!URL)("SQL de produção: OS gerada pelo orçamento (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "orcamentos" ("id" TEXT PRIMARY KEY, "codigo" TEXT NOT NULL);
      CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL);
      CREATE TABLE "orcamento_ordens_servico" ("id" TEXT PRIMARY KEY, "orcamento_id" TEXT NOT NULL, "ordem_servico_id" TEXT NOT NULL);
      INSERT INTO "orcamentos" VALUES ('o1', 'ORC-1'), ('o2', 'ORC-2');
      INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1'), ('os2', 'OS-2'), ('os3', 'OS-3');
      INSERT INTO "orcamento_ordens_servico" VALUES ('v1', 'o1', 'os1');
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("coluna nova TEXT nula, sem padrão; OS existentes intactas e sem origem (sem backfill, mesmo a já vinculada)", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'ordens_servico' AND column_name = 'orcamento_origem_id'`))
      .toBe("text:YES:-");
    expect(sql(`SELECT string_agg(numero || '=' || COALESCE(orcamento_origem_id, 'null'), ',' ORDER BY id) FROM ordens_servico`)).toBe("OS-1=null,OS-2=null,OS-3=null");
    expect(sql(`SELECT count(*) FROM orcamento_ordens_servico`)).toBe("1");
  });

  it("ÚNICO: o mesmo orçamento não gera duas OS; várias OS sem origem convivem", () => {
    expect(falha(`UPDATE ordens_servico SET orcamento_origem_id = 'o1' WHERE id = 'os2'`)).toBe("gravou");
    expect(falha(`UPDATE ordens_servico SET orcamento_origem_id = 'o1' WHERE id = 'os3'`)).toContain("ordens_servico_orcamento_origem_id_key");
    expect(falha(`UPDATE ordens_servico SET orcamento_origem_id = 'o2' WHERE id = 'os3'`)).toBe("gravou");
    expect(sql(`SELECT count(*) FROM ordens_servico WHERE orcamento_origem_id IS NULL`)).toBe("1");
  });

  it("FK: orçamento inexistente é recusado; apagar o orçamento NÃO apaga a OS (origem vira nula)", () => {
    expect(falha(`UPDATE ordens_servico SET orcamento_origem_id = 'nao-existe' WHERE id = 'os1'`)).toContain("ordens_servico_orcamento_origem_id_fkey");
    sql(`DELETE FROM orcamentos WHERE id = 'o2'`);
    expect(sql(`SELECT numero || '=' || COALESCE(orcamento_origem_id, 'null') FROM ordens_servico WHERE id = 'os3'`)).toBe("OS-3=null");
  });

  it("2ª e 3ª rodadas não mudam nada (dado gravado fica; índice e FK não duplicam)", () => {
    rodar();
    rodar();
    expect(sql(`SELECT orcamento_origem_id FROM ordens_servico WHERE id = 'os2'`)).toBe("o1");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'ordens_servico_orcamento_origem_id_key'`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'ordens_servico'::regclass AND conname = 'ordens_servico_orcamento_origem_id_fkey'`)).toBe("1");
  });
});
