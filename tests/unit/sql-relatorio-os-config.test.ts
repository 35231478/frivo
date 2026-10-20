/**
 * Relatório da OS — o SQL de produção (prisma/sql/2026-10-20_relatorio_os_config.sql) rodado de
 * verdade num PostgreSQL: schema descartável com "configuracoes" como está HOJE (sem a coluna),
 * roda o arquivo DUAS vezes e confere.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-relatorio-os-config
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-20_relatorio_os_config.sql");
const SCHEMA = `teste_relos_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);

describe.skipIf(!URL)("SQL de produção: configuração de impressão da OS (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE, "os_exigir_foto" BOOLEAN NOT NULL DEFAULT false, "qr_config" JSONB);
      INSERT INTO "configuracoes" VALUES ('c1', 'e1', true, '{"botaoWhatsapp": false}'), ('c2', 'e2', false, NULL);
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria a coluna JSONB opcional, sem padrão — rodando 2x não duplica nem falha", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'configuracoes' AND column_name = 'relatorio_os_config'`))
      .toBe("jsonb:YES:-");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'configuracoes'`)).toBe("5");
  });

  it("linhas existentes ficam iguais e sem config (= padrões do sistema)", () => {
    expect(sql(`SELECT string_agg("id" || '|' || "os_exigir_foto" || '|' || COALESCE("qr_config"::text, '-') || '|' || COALESCE("relatorio_os_config"::text, 'NULL'), ';' ORDER BY "id") FROM "configuracoes"`))
      .toBe(`c1|true|{"botaoWhatsapp": false}|NULL;c2|false|-|NULL`);
  });

  it("guarda e lê a configuração (JSON) por empresa", () => {
    sql(`UPDATE "configuracoes" SET "relatorio_os_config" = '{"fotos": {"ativo": true, "cliente": false}}' WHERE "empresa_id" = 'e1'`);
    expect(sql(`SELECT "relatorio_os_config"->'fotos'->>'cliente' FROM "configuracoes" WHERE "empresa_id" = 'e1'`)).toBe("false");
    expect(sql(`SELECT COALESCE("relatorio_os_config"::text, 'NULL') FROM "configuracoes" WHERE "empresa_id" = 'e2'`)).toBe("NULL");
  });
});
