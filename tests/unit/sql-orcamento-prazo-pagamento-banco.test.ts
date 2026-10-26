/**
 * Orçamento (prazo de execução, forma de pagamento) e empresa (dados bancários) — o SQL de produção
 * (prisma/sql/2026-10-28_orcamento_prazo_pagamento_banco.sql) rodado de verdade num PostgreSQL: schema
 * descartável com "orcamentos" e "empresas" como estão HOJE (com dados), roda o arquivo DUAS vezes e
 * confere: colunas opcionais (TEXT NULL), nada mexido nos dados que já existiam, 2ª rodada sem efeito.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-orcamento-prazo
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-28_orcamento_prazo_pagamento_banco.sql");
const SCHEMA = `teste_orc_prazo_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodarArquivo = () => psql(["-f", ARQUIVO]);
const coluna = (tabela: string, nome: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${nome}'`);

describe.skipIf(!URL)("SQL de produção: prazo/forma de pagamento do orçamento e dados bancários da empresa (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "cnpj" TEXT NOT NULL);
      CREATE TABLE "orcamentos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "total_geral" DECIMAL(12,2) NOT NULL DEFAULT 0);
      INSERT INTO "empresas" VALUES ('e1', 'Clima Total', '12345678000190');
      INSERT INTO "orcamentos" VALUES ('o1', 'Preventiva', 1500), ('o2', 'Corretiva', 380.5);
    `);
    rodarArquivo();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria as colunas opcionais (TEXT NULL, sem default)", () => {
    for (const c of ["prazo_execucao", "forma_pagamento"]) expect(coluna("orcamentos", c), c).toBe("text:YES:-");
    for (const c of ["banco_nome", "banco_agencia", "banco_conta", "banco_tipo_conta", "banco_titular", "pix_chave"]) expect(coluna("empresas", c), c).toBe("text:YES:-");
  });

  it("orçamentos e empresa existentes ficam como estavam (campos novos vazios)", () => {
    expect(sql(`SELECT string_agg("id" || '=' || "total_geral" || '/' || coalesce("prazo_execucao", '∅') || '/' || coalesce("forma_pagamento", '∅'), ',' ORDER BY "id") FROM "orcamentos"`)).toBe("o1=1500.00/∅/∅,o2=380.50/∅/∅");
    expect(sql(`SELECT count(*) FROM "empresas" WHERE coalesce("banco_nome", "banco_agencia", "banco_conta", "banco_tipo_conta", "banco_titular", "pix_chave") IS NOT NULL`)).toBe("0");
  });

  it("rodar de novo não falha nem apaga o que foi preenchido", () => {
    sql(`UPDATE "orcamentos" SET "prazo_execucao" = '5 dias úteis', "forma_pagamento" = 'PIX' WHERE "id" = 'o1'`);
    sql(`UPDATE "empresas" SET "banco_nome" = 'Banco Inter (077)', "pix_chave" = '12345678000190' WHERE "id" = 'e1'`);
    rodarArquivo();
    expect(sql(`SELECT "prazo_execucao" || '|' || "forma_pagamento" FROM "orcamentos" WHERE "id" = 'o1'`)).toBe("5 dias úteis|PIX");
    expect(sql(`SELECT "banco_nome" || '|' || "pix_chave" FROM "empresas"`)).toBe("Banco Inter (077)|12345678000190");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND column_name IN ('prazo_execucao','forma_pagamento','banco_nome','banco_agencia','banco_conta','banco_tipo_conta','banco_titular','pix_chave')`)).toBe("8");
  });
});
