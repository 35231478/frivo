/**
 * NFS-e PR2 — dados fiscais do serviço: o SQL de produção rodado de verdade num PostgreSQL, numa
 * transação só (como o `prisma db execute`), TRÊS vezes, num schema descartável com a tabela
 * servicos como está HOJE (com codigo_lc116, codigo_municipal e aliquota_iss, que são reaproveitados):
 *  - colunas novas nfse_tributacao, iss_retido (NOT NULL DEFAULT false), cnae (7 dígitos), discriminacao_padrao;
 *  - serviços existentes intactos e SEM dados fiscais novos (sem backfill); 2ª e 3ª rodadas: nada muda;
 *  - CHECKs: tributação só os 6 valores conhecidos; CNAE só 7 dígitos.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-nfse-servico-fiscal
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { TRIBUTACOES_ISS } from "@/lib/nfse/servico";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-06_nfse_servico_fiscal.sql");
const SCHEMA = `teste_nfse_servico_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const coluna = (nome: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') || ':' || COALESCE(character_maximum_length::text, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'servicos' AND column_name = '${nome}'`);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };

describe.skipIf(!URL)("SQL de produção: NFS-e dados fiscais do serviço (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "servicos" (
        "id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL,
        "codigo_municipal" TEXT, "codigo_lc116" TEXT, "aliquota_iss" DECIMAL(5,2)
      );
      INSERT INTO "servicos" VALUES ('s1', 'e1', 'Limpeza de split', '1401', '14.01', 5);
      INSERT INTO "servicos" (id, empresa_id, nome) VALUES ('s2', 'e1', 'Sem fiscal');
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("colunas novas com os tipos certos (retido nunca nulo: falso por padrão)", () => {
    expect(coluna("nfse_tributacao")).toBe("text:YES:-:-");
    expect(coluna("iss_retido")).toBe("boolean:NO:false:-");
    expect(coluna("cnae")).toBe("character varying:YES:-:7");
    expect(coluna("discriminacao_padrao")).toBe("text:YES:-:-");
  });

  it("sem backfill: existentes intactos e sem os dados novos; 2ª e 3ª rodadas não mudam nada", () => {
    const linha = (id: string) => sql(`SELECT concat_ws('|', nome, codigo_municipal, codigo_lc116, aliquota_iss, COALESCE(nfse_tributacao, 'null'), iss_retido, COALESCE(cnae, 'null'), COALESCE(discriminacao_padrao, 'null')) FROM servicos WHERE id = '${id}'`);
    expect(linha("s1")).toBe("Limpeza de split|1401|14.01|5.00|null|f|null|null");
    expect(linha("s2")).toBe("Sem fiscal|null|f|null|null");
    sql(`UPDATE servicos SET nfse_tributacao = 'ISENTO', iss_retido = true, cnae = '4322302', discriminacao_padrao = 'Texto' WHERE id = 's1'`);
    rodar();
    rodar();
    expect(linha("s1")).toBe("Limpeza de split|1401|14.01|5.00|ISENTO|t|4322302|Texto");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'servicos'::regclass AND conname IN ('servicos_nfse_tributacao_check', 'servicos_cnae_check')`)).toBe("2");
  });

  it("CHECK da tributação aceita exatamente os valores do sistema (os mesmos da tela)", () => {
    for (const t of TRIBUTACOES_ISS) expect(falha(`UPDATE servicos SET nfse_tributacao = '${t.id}' WHERE id = 's2'`)).toBe("gravou");
    expect(falha(`UPDATE servicos SET nfse_tributacao = NULL WHERE id = 's2'`)).toBe("gravou");
    expect(falha(`UPDATE servicos SET nfse_tributacao = 'tributavel' WHERE id = 's2'`)).toContain("servicos_nfse_tributacao_check");
    expect(falha(`UPDATE servicos SET nfse_tributacao = '6' WHERE id = 's2'`)).toContain("servicos_nfse_tributacao_check");
  });

  it("CHECK do CNAE: só os 7 dígitos (a máscara 4321-5/00 é da tela, não do banco)", () => {
    expect(falha(`UPDATE servicos SET cnae = '4321500' WHERE id = 's2'`)).toBe("gravou");
    expect(falha(`UPDATE servicos SET cnae = '4321-50' WHERE id = 's2'`)).toContain("servicos_cnae_check");
    expect(falha(`UPDATE servicos SET cnae = '432150' WHERE id = 's2'`)).toContain("servicos_cnae_check");
    expect(falha(`UPDATE servicos SET iss_retido = NULL WHERE id = 's2'`)).toContain("null");
  });
});
