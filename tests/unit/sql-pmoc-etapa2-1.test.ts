/**
 * PMOC — Etapa 2.1 (fim de semana no cronograma): o SQL de produção
 * (prisma/sql/2026-12-12_pmoc_cronograma_fim_semana.sql) rodado de verdade num PostgreSQL descartável,
 * POR CIMA do banco como ele está depois da Etapa 2 (com itens de cronograma já gravados):
 *  - acrescenta UMA coluna ("pmoc_cronogramas"."fim_semana") e mais nada;
 *  - é idempotente (roda duas, três vezes) e não mexe no que já está gravado;
 *  - os itens que já existiam ficam MANTER (as OS já geradas não mudam de data);
 *  - usa o tipo que os contratos já usam ("TratamentoFimSemana"): não cria nem altera enum;
 *  - o resultado é EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 * A substituição (maior intervalo vale no mês) é só regra da aplicação: não tem banco.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-pmoc-etapa2-1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ETAPA_2 = path.join(RAIZ, "prisma/sql/2026-12-10_pmoc_etapa2_cronograma.sql");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-12_pmoc_cronograma_fim_semana.sql");
const SCHEMA = `teste_pmoc21_sql_${process.pid}`;
const PRISMA = `teste_pmoc21_sql_prisma_${process.pid}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção antes deste arquivo: o tipo dos contratos e o que o cronograma referencia */
const BASE = `
  CREATE TYPE "TratamentoFimSemana" AS ENUM ('MANTER', 'ADIANTAR', 'POSTERGAR');
  CREATE TABLE "contratos" ("id" TEXT PRIMARY KEY, "recorrencia_fim_semana" "TratamentoFimSemana" NOT NULL DEFAULT 'MANTER');
  CREATE TABLE "pmocs" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "tipos_os" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "tipos_equipamento_custom" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY, "nome" TEXT);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'AGENDADA');
  INSERT INTO "contratos" VALUES ('ct1', 'POSTERGAR');
  INSERT INTO "pmocs" VALUES ('p1', 'PMOC 2026');
  INSERT INTO "tipos_os" VALUES ('to1', 'PMOC mensal');
  INSERT INTO "equipamentos" VALUES ('q1', 'Split 1');
  INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1');
`;
/** Itens e execuções gravados pela Etapa 2, ANTES de a coluna existir */
const JA_GRAVADO = `
  INSERT INTO "pmoc_cronogramas" ("id", "pmoc_id", "tipo_os_id", "data_inicio", "intervalo_meses", "dia_execucao", "atualizado_em") VALUES
    ('i1', 'p1', 'to1', '2026-11-12', 1, 14, '2026-11-12 15:00'), ('i2', 'p1', 'to1', '2026-11-12', 6, 25, '2026-11-12 15:00');
  INSERT INTO "pmoc_execucoes" ("id", "pmoc_id", "cronograma_id", "equipamento_id", "periodo", "data_prevista", "ordem_servico_id") VALUES
    ('x1', 'p1', 'i1', 'q1', '2026-11', '2026-11-14 15:00', 'os1');
`;
const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const nomesDasColunas = (tabela: string) => sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}'`);
const retrato = () => sql(`SELECT string_agg("id" || '|' || "intervalo_meses" || '|' || "dia_execucao" || '|' || "ativo" || '|' || "atualizado_em", ';' ORDER BY "id") FROM "pmoc_cronogramas"`);
const fins = () => sql(`SELECT string_agg("id" || ':' || "fim_semana", ',' ORDER BY "id") FROM "pmoc_cronogramas"`);

describe.skipIf(!URL)("SQL de produção: PMOC — Etapa 2.1, fim de semana no cronograma (PostgreSQL real)", () => {
  let antes = "", colunasAntes: Record<string, string> = {};
  const OUTRAS = ["pmoc_execucoes", "pmocs", "tipos_os", "tipos_equipamento_custom", "equipamentos", "ordens_servico", "contratos"];

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    psql(["-f", ETAPA_2]);
    sql(JA_GRAVADO);
    antes = retrato();
    colunasAntes = Object.fromEntries(OUTRAS.map((t) => [t, nomesDasColunas(t)]));
    expect(nomesDasColunas("pmoc_cronogramas")).not.toContain("fim_semana"); // produção antes deste arquivo
    psql(["-f", ARQUIVO]);
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" }); });

  it("acrescenta UMA coluna, no fim da tabela do cronograma — e em nenhuma outra tabela", () => {
    expect(nomesDasColunas("pmoc_cronogramas")).toBe("id,pmoc_id,tipo_equipamento_id,equipamento_id,tipo_os_id,data_inicio,intervalo_meses,dia_execucao,ativo,criado_em,atualizado_em,fim_semana");
    for (const t of OUTRAS) expect(nomesDasColunas(t), t).toBe(colunasAntes[t]);
  });

  it("os itens que JÁ existiam ficam MANTER e não mudam em mais nada (nem a data de atualização); as execuções ficam", () => {
    expect(fins()).toBe("i1:MANTER,i2:MANTER");
    expect(retrato()).toBe(antes);
    expect(sql(`SELECT "id" || '|' || "periodo" || '|' || "data_prevista" || '|' || "ordem_servico_id" FROM "pmoc_execucoes"`)).toBe("x1|2026-11|2026-11-14 15:00:00|os1");
  });

  it("a tabela fica IDÊNTICA à que o Prisma espera — colunas, tipos, padrões, índices e chaves", () => {
    for (const t of ["pmoc_cronogramas", "pmoc_execucoes"]) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), t).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), t).toBe(chaves(PRISMA, t));
    }
    expect(colunas(SCHEMA, "pmoc_cronogramas")).toContain(`fim_semana USER-DEFINED TratamentoFimSemana NO 'MANTER'::"TratamentoFimSemana" -`);
  });

  it("aceita as três opções, recusa qualquer outra e não aceita vazio; item novo sem a coluna nasce MANTER no banco", () => {
    sql(`UPDATE "pmoc_cronogramas" SET "fim_semana" = 'POSTERGAR' WHERE "id" = 'i1'; UPDATE "pmoc_cronogramas" SET "fim_semana" = 'ADIANTAR' WHERE "id" = 'i2';`);
    expect(fins()).toBe("i1:POSTERGAR,i2:ADIANTAR");
    expect(() => sql(`UPDATE "pmoc_cronogramas" SET "fim_semana" = 'ANTECIPAR' WHERE "id" = 'i1'`)).toThrow(/invalid input value for enum "TratamentoFimSemana"/);
    expect(() => sql(`UPDATE "pmoc_cronogramas" SET "fim_semana" = NULL WHERE "id" = 'i1'`)).toThrow(/null value in column "fim_semana"/);
    sql(`INSERT INTO "pmoc_cronogramas" ("id", "pmoc_id", "tipo_os_id", "data_inicio", "dia_execucao", "atualizado_em") VALUES ('i3', 'p1', 'to1', '2026-11-12', 25, now())`);
    expect(fins()).toBe("i1:POSTERGAR,i2:ADIANTAR,i3:MANTER");
  });

  it("IDEMPOTENTE: rodar de novo (duas vezes) não falha e NÃO desfaz o que já foi escolhido", () => {
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    expect(fins()).toBe("i1:POSTERGAR,i2:ADIANTAR,i3:MANTER");
    expect(nomesDasColunas("pmoc_cronogramas").split(",")).toHaveLength(12);
  });

  it("não cria nem altera enum: o tipo dos contratos continua com os mesmos três valores, e os contratos não são tocados", () => {
    expect(sql(`SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'TratamentoFimSemana' AND n.nspname = '${SCHEMA}'`)).toBe("MANTER,ADIANTAR,POSTERGAR");
    expect(sql(`SELECT "id" || ':' || "recorrencia_fim_semana" FROM "contratos"`)).toBe("ct1:POSTERGAR");
  });

  it("é só aditivo: um único comando (ADD COLUMN IF NOT EXISTS), sem enum, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--") && l.trim()).join("\n");
    expect(fonte).toBe(`ALTER TABLE "pmoc_cronogramas" ADD COLUMN IF NOT EXISTS "fim_semana" "TratamentoFimSemana" NOT NULL DEFAULT 'MANTER';`);
    expect(fonte).not.toMatch(/CREATE TYPE|ALTER TYPE|ADD VALUE|\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
  });

  it("o schema do Prisma aponta para a mesma coluna, com o mesmo tipo dos contratos e o mesmo padrão", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model PmocCronograma \{[\s\S]*?fimSemana\s+TratamentoFimSemana\s+@default\(MANTER\)\s+@map\("fim_semana"\)[\s\S]*?@@map\("pmoc_cronogramas"\)/);
    expect(schema).toMatch(/enum TratamentoFimSemana \{\s+MANTER\s+ADIANTAR\s+POSTERGAR\s+\}/);
  });
});
