/**
 * NFS-e — CNAE principal da empresa: o SQL de produção rodado de verdade num PostgreSQL, numa
 * transação só (como o `prisma db execute`), TRÊS vezes, num schema descartável com a tabela
 * empresas como está HOJE: coluna nova cnae_principal VARCHAR(7) nula, CHECK de 7 dígitos,
 * empresas existentes intactas (sem backfill); 2ª e 3ª rodadas: nada muda.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-nfse-cnae-empresa
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-07_nfse_cnae_empresa.sql");
const SCHEMA = `teste_nfse_cnae_empresa_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };

describe.skipIf(!URL)("SQL de produção: CNAE principal da empresa (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "inscricao_municipal" TEXT);
      INSERT INTO "empresas" VALUES ('e1', 'Clima Total', '12345');
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("coluna nova: VARCHAR(7) nula, sem padrão; empresa existente intacta e sem CNAE (sem backfill)", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') || ':' || character_maximum_length FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'empresas' AND column_name = 'cnae_principal'`))
      .toBe("character varying:YES:-:7");
    expect(sql(`SELECT concat_ws('|', nome, inscricao_municipal, COALESCE(cnae_principal, 'null')) FROM empresas WHERE id = 'e1'`)).toBe("Clima Total|12345|null");
  });

  it("CHECK: só os 7 dígitos (a máscara é da tela); nulo vale", () => {
    expect(falha(`UPDATE empresas SET cnae_principal = '4322302' WHERE id = 'e1'`)).toBe("gravou");
    expect(falha(`UPDATE empresas SET cnae_principal = '4322-30' WHERE id = 'e1'`)).toContain("empresas_cnae_principal_check");
    expect(falha(`UPDATE empresas SET cnae_principal = '432230' WHERE id = 'e1'`)).toContain("empresas_cnae_principal_check");
    expect(falha(`UPDATE empresas SET cnae_principal = NULL WHERE id = 'e1'`)).toBe("gravou");
  });

  it("2ª e 3ª rodadas não mudam nada (dado gravado fica; CHECK não duplica)", () => {
    sql(`UPDATE empresas SET cnae_principal = '4322302' WHERE id = 'e1'`);
    rodar();
    rodar();
    expect(sql(`SELECT cnae_principal FROM empresas WHERE id = 'e1'`)).toBe("4322302");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'empresas'::regclass AND conname = 'empresas_cnae_principal_check'`)).toBe("1");
  });
});
