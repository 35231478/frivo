/**
 * NFS-e PR3 (B) — o SQL de produção do aviso automático rodado de verdade num PostgreSQL, numa
 * transação só, TRÊS vezes, num schema descartável com as duas tabelas como estão HOJE (só as
 * colunas usadas): colunas novas do webhook em empresa_fiscal (hash único), aviso_visto_em nas notas
 * com o "já visto" SÓ para as notas que já tinham terminado na 1ª rodada (a 2ª e a 3ª não marcam as
 * novas), índices, e nada mais mexido.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-nfse-webhook
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-09_nfse_webhook.sql");
const SCHEMA = `teste_sql_nfse_webhook_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const colunas = (t: string) => sql(`SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${t}'`);
const vistos = () => sql("SELECT string_agg(id || '=' || COALESCE(to_char(aviso_visto_em, 'YYYY-MM-DD HH24:MI'), '-'), ',' ORDER BY id) FROM notas_fiscais");

describe.skipIf(!URL)("SQL de produção: aviso automático do PlugNotas + sino (PostgreSQL real)", () => {
  let colunasFiscalAntes = "";
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresa_fiscal" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE, "status" TEXT NOT NULL DEFAULT 'NAO_CONFIGURADO',
        "emitente_cnpj" VARCHAR(14), "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "notas_fiscais" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ENVIANDO',
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO empresa_fiscal (id, empresa_id, status) VALUES ('f1', 'e1', 'ATIVO'), ('f2', 'e2', 'ATIVO');
      INSERT INTO notas_fiscais (id, empresa_id, status, atualizado_em) VALUES
        ('n1', 'e1', 'CONCLUIDO', '2026-10-20 10:00'), ('n2', 'e1', 'REJEITADO', '2026-10-21 11:00'), ('n3', 'e1', 'CANCELADO', '2026-10-22 12:00'),
        ('n4', 'e1', 'INTERROMPIDO', '2026-10-23 13:00'), ('n5', 'e1', 'PROCESSANDO', '2026-10-24 14:00'), ('n6', 'e1', 'ENVIANDO', '2026-10-25 15:00');
    `);
    colunasFiscalAntes = colunas("empresa_fiscal");
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("empresa_fiscal: só colunas novas no fim (hash VARCHAR(64), datas, ambiente, erro), todas opcionais", () => {
    const depois = colunas("empresa_fiscal");
    expect(depois.startsWith(colunasFiscalAntes)).toBe(true);
    expect(depois.slice(colunasFiscalAntes.length + 1).split(",")).toEqual([
      "webhook_token_hash:character varying:YES", "webhook_gerado_em:timestamp without time zone:YES", "webhook_ambiente:text:YES",
      "webhook_registrado_em:timestamp without time zone:YES", "webhook_erro:text:YES", "webhook_recebido_em:timestamp without time zone:YES",
    ]);
    expect(sql(`SELECT character_maximum_length FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'empresa_fiscal' AND column_name = 'webhook_token_hash'`)).toBe("64");
    expect(sql("SELECT count(*) FROM empresa_fiscal WHERE webhook_token_hash IS NOT NULL")).toBe("0"); // ninguém ligado: cada empresa gera a sua URL
  });

  it("o hash é único (duas empresas não dividem a mesma URL); vários NULL podem", () => {
    sql("UPDATE empresa_fiscal SET webhook_token_hash = repeat('a', 64) WHERE id = 'f1'");
    expect(falha("UPDATE empresa_fiscal SET webhook_token_hash = repeat('a', 64) WHERE id = 'f2'")).toMatch(/empresa_fiscal_webhook_token_hash_key/);
    expect(falha("UPDATE empresa_fiscal SET webhook_token_hash = repeat('a', 65) WHERE id = 'f2'")).toMatch(/too long|value too long/);
    sql("UPDATE empresa_fiscal SET webhook_token_hash = NULL WHERE id = 'f1'");
  });

  it("notas: aviso_visto_em novo; as que já tinham terminado entram como vistas (na data em que terminaram); as que esperam, não", () => {
    expect(colunas("notas_fiscais").split(",").at(-1)).toBe("aviso_visto_em:timestamp without time zone:YES");
    expect(vistos()).toBe("n1=2026-10-20 10:00,n2=2026-10-21 11:00,n3=2026-10-22 12:00,n4=2026-10-23 13:00,n5=-,n6=-");
  });

  it("índices: hash único e (empresa_id, aviso_visto_em) para o sino", () => {
    expect(sql(`SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND (indexname LIKE '%webhook%' OR indexname LIKE '%aviso%')`))
      .toBe("empresa_fiscal_webhook_token_hash_key,notas_fiscais_empresa_id_aviso_visto_em_idx");
    expect(sql(`SELECT indexdef FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'notas_fiscais_empresa_id_aviso_visto_em_idx'`)).toMatch(/\(empresa_id, aviso_visto_em\)/);
  });

  it("2ª e 3ª rodadas: nada muda — e o 'já visto' NÃO pega as notas que terminaram depois da 1ª", () => {
    sql("UPDATE empresa_fiscal SET webhook_token_hash = repeat('b', 64), webhook_erro = 'x' WHERE id = 'f1'");
    sql("UPDATE notas_fiscais SET status = 'CONCLUIDO' WHERE id = 'n5'"); // autorizou depois do SQL: o sino tem que avisar
    sql("INSERT INTO notas_fiscais (id, empresa_id, status) VALUES ('n7', 'e1', 'REJEITADO')");
    const antes = [colunas("empresa_fiscal"), colunas("notas_fiscais"), vistos(), sql("SELECT webhook_token_hash || webhook_erro FROM empresa_fiscal WHERE id = 'f1'")];
    rodar();
    rodar();
    expect([colunas("empresa_fiscal"), colunas("notas_fiscais"), vistos(), sql("SELECT webhook_token_hash || webhook_erro FROM empresa_fiscal WHERE id = 'f1'")]).toEqual(antes);
    expect(vistos()).toContain("n5=-");
    expect(vistos()).toContain("n7=-");
  });
});
