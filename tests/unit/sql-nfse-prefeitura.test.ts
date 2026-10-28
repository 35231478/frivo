/**
 * NFS-e — autenticação da prefeitura: o SQL de produção rodado de verdade num PostgreSQL, numa
 * transação só (como o `prisma db execute`), TRÊS vezes, num schema descartável com a tabela
 * empresa_fiscal como está HOJE (depois de 2026-11-04_nfse_emitente.sql):
 *  - colunas novas prefeitura_cripto (TEXT, nula) e prefeitura_atualizada_em (TIMESTAMP(3), nula);
 *  - dados existentes intactos; 2ª e 3ª rodadas: nada muda.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-nfse-prefeitura
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const EMITENTE = path.resolve(__dirname, "../../prisma/sql/2026-11-04_nfse_emitente.sql");
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-05_nfse_prefeitura.sql");
const SCHEMA = `teste_nfse_prefeitura_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = (arquivo = ARQUIVO) => psql(["--single-transaction", "-f", arquivo]);
const coluna = (nome: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') || ':' || COALESCE(datetime_precision::text, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'empresa_fiscal' AND column_name = '${nome}'`);

describe.skipIf(!URL)("SQL de produção: NFS-e autenticação da prefeitura (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TYPE "TipoPerfilAcesso" AS ENUM ('ADMINISTRADOR', 'SUPERVISOR', 'FINANCEIRO', 'TECNICO', 'AUXILIAR', 'PERSONALIZADO');
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "perfis_acesso" ("id" TEXT PRIMARY KEY, "tipo" "TipoPerfilAcesso" NOT NULL DEFAULT 'PERSONALIZADO', "permissoes" JSONB NOT NULL);
      INSERT INTO "empresas" VALUES ('e1');
    `);
    rodar(EMITENTE); // a tabela como está em produção hoje
    sql(`INSERT INTO empresa_fiscal (id, empresa_id, status, certificado_id) VALUES ('f1', 'e1', 'ATIVO', 'cert-1')`);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("colunas novas: credencial só cifrada em TEXT nulo + data da última troca", () => {
    expect(coluna("prefeitura_cripto")).toBe("text:YES:-:-");
    expect(coluna("prefeitura_atualizada_em")).toBe("timestamp without time zone:YES:-:3");
    // não existe coluna em texto puro para login/senha
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'empresa_fiscal' AND column_name ~ 'prefeitura_(login|senha)'`)).toBe("0");
  });
  it("dados existentes intactos (colunas novas nulas); 2ª e 3ª rodadas não mudam nada", () => {
    expect(sql(`SELECT status || ':' || certificado_id || ':' || COALESCE(prefeitura_cripto, 'null') FROM empresa_fiscal WHERE id = 'f1'`)).toBe("ATIVO:cert-1:null");
    sql(`UPDATE empresa_fiscal SET prefeitura_cripto = 'iv.tag.dado', prefeitura_atualizada_em = '2026-10-28 12:00:00' WHERE id = 'f1'`);
    rodar();
    rodar();
    expect(sql(`SELECT prefeitura_cripto || '|' || prefeitura_atualizada_em FROM empresa_fiscal WHERE id = 'f1'`)).toBe("iv.tag.dado|2026-10-28 12:00:00");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'empresa_fiscal' AND column_name LIKE 'prefeitura%'`)).toBe("2");
  });
});
