/**
 * PMOC — Etapa 2 (cronograma): o SQL de produção (prisma/sql/2026-12-10_pmoc_etapa2_cronograma.sql)
 * rodado de verdade num PostgreSQL descartável: cria DUAS tabelas ("pmoc_cronogramas" e
 * "pmoc_execucoes"), é idempotente (roda duas vezes), não mexe em mais nada — nem em "ordens_servico" —
 * e o resultado é EXATAMENTE o que o Prisma espera (comparado com o schema.prisma aplicado por
 * `prisma db push`). Não cria enum: a frequência é um número de meses.
 * Desde a Etapa 2.1 o schema tem a coluna "fim_semana" (prisma/sql/2026-12-12_pmoc_cronograma_fim_semana.sql):
 * a comparação com o Prisma é feita com os DOIS arquivos aplicados, na ordem em que vão para produção.
 * O arquivo da Etapa 2.1 tem o seu próprio teste (sql-pmoc-etapa2-1).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-pmoc-etapa2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-10_pmoc_etapa2_cronograma.sql");
const ARQUIVO_2_1 = path.join(RAIZ, "prisma/sql/2026-12-12_pmoc_cronograma_fim_semana.sql");
const SCHEMA = `teste_pmoc2_sql_${process.pid}`;
const PRISMA = `teste_pmoc2_sql_prisma_${process.pid}`;
const TABELAS = ["pmoc_cronogramas", "pmoc_execucoes"] as const;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** O que o cronograma referencia, como já existe em produção (só o necessário para as chaves) */
const BASE = `
  CREATE TYPE "TratamentoFimSemana" AS ENUM ('MANTER', 'ADIANTAR', 'POSTERGAR');
  CREATE TABLE "pmocs" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "tipos_os" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "tipos_equipamento_custom" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY, "nome" TEXT);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'AGENDADA');
  INSERT INTO "pmocs" VALUES ('p1', 'PMOC 2026'), ('p2', 'PMOC do anexo');
  INSERT INTO "tipos_os" VALUES ('to1', 'PMOC mensal');
  INSERT INTO "tipos_equipamento_custom" VALUES ('te1', 'Split');
  INSERT INTO "equipamentos" VALUES ('q1', 'Split 1'), ('q2', 'Split 2');
  INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1'), ('os2', 'OS-2');
`;

const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const colunasDe = (schema: string, tabela: string) => sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}'`);
const item = (id: string, pmoc = "p1", extra = "") => sql(`INSERT INTO "pmoc_cronogramas" ("id", "pmoc_id", "tipo_os_id", "data_inicio", "dia_execucao", "atualizado_em"${extra ? ', "tipo_equipamento_id"' : ""})
  VALUES ('${id}', '${pmoc}', 'to1', '2026-11-12', 25, now()${extra}) RETURNING "intervalo_meses" || '|' || "ativo" || '|' || coalesce("tipo_equipamento_id", 'null') || '|' || coalesce("equipamento_id", 'null')`);
const execucao = (id: string, cronograma: string, equipamento: string, periodo: string, os: string | null = "os1", pmoc = "p1") => sql(`INSERT INTO "pmoc_execucoes" ("id", "pmoc_id", "cronograma_id", "equipamento_id", "periodo", "data_prevista", "ordem_servico_id")
  VALUES ('${id}', '${pmoc}', '${cronograma}', '${equipamento}', '${periodo}', '2026-11-25 15:00', ${os ? `'${os}'` : "NULL"}) ON CONFLICT DO NOTHING RETURNING "id"`);

describe.skipIf(!URL)("SQL de produção: PMOC — Etapa 2, cronograma (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente, não pode falhar
    psql(["-f", ARQUIVO_2_1]); // a coluna da Etapa 2.1, por cima
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" }); });

  it("as duas tabelas são IDÊNTICAS às que o Prisma espera — colunas, tipos, padrões, índices e chaves", () => {
    for (const t of TABELAS) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), t).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), t).toBe(chaves(PRISMA, t));
    }
    expect(colunas(SCHEMA, "pmoc_cronogramas").split("\n")).toHaveLength(12); // 11 da Etapa 2 + "fim_semana" (Etapa 2.1)
    expect(colunas(SCHEMA, "pmoc_execucoes").split("\n")).toHaveLength(8);
    // 4 chaves estrangeiras + a primária em cada tabela
    expect(chaves(SCHEMA, "pmoc_cronogramas").split("\n")).toHaveLength(5);
    expect(chaves(SCHEMA, "pmoc_execucoes").split("\n")).toHaveLength(5);
  });

  it("a tabela de ordens de serviço NÃO ganha coluna: a OS é ligada ao plano pela tabela de execuções", () => {
    expect(colunasDe(SCHEMA, "ordens_servico")).toBe("id,numero,status");
    for (const t of ["pmocs", "tipos_os", "tipos_equipamento_custom", "equipamentos"]) expect(colunasDe(SCHEMA, t), t).toBe(t === "equipamentos" ? "id,nome" : "id,nome");
  });

  it("o item nasce mensal (a cada 1 mês) e ativo; sem tipo nem equipamento = todos os equipamentos do plano", () => {
    expect(item("i1")).toBe("1|true|null|null");
    expect(item("i2", "p1", ", 'te1'")).toBe("1|true|te1|null");
    expect(item("i3", "p2")).toBe("1|true|null|null");
  });

  it("IDEMPOTÊNCIA no banco: a mesma execução (item + equipamento + competência) não entra duas vezes", () => {
    expect(execucao("x1", "i1", "q1", "2026-11")).toBe("x1");
    expect(execucao("x2", "i1", "q1", "2026-11", "os2")).toBe("");  // de novo: recusada pela chave única
    expect(execucao("x3", "i1", "q2", "2026-11")).toBe("x3");       // outro equipamento, mesma OS
    expect(execucao("x4", "i1", "q1", "2026-12", "os2")).toBe("x4"); // outra competência
    expect(execucao("x5", "i2", "q1", "2026-11", "os2")).toBe("x5"); // outro item do cronograma
    expect(() => sql(`INSERT INTO "pmoc_execucoes" ("id", "pmoc_id", "cronograma_id", "equipamento_id", "periodo", "data_prevista") VALUES ('x9', 'p1', 'i1', 'q1', '2026-11', now())`)).toThrow(/pmoc_execucoes_cronograma_id_equipamento_id_periodo_key/);
  });

  it("rodar o SQL de novo não mexe no que já foi gravado", () => {
    psql(["-f", ARQUIVO]);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "pmoc_execucoes"`)).toBe("x1,x3,x4,x5");
    expect(sql(`SELECT count(*) FROM "pmoc_cronogramas"`)).toBe("3");
  });

  it("apagar a OS não apaga a execução: o vínculo fica vazio (SET NULL) e a competência não é gerada de novo", () => {
    sql(`DELETE FROM "ordens_servico" WHERE "id" = 'os2'`);
    expect(sql(`SELECT string_agg("id" || ':' || coalesce("ordem_servico_id", 'null'), ',' ORDER BY "id") FROM "pmoc_execucoes"`)).toBe("x1:os1,x3:os1,x4:null,x5:null");
  });

  it("tipo de OS e tipo de equipamento em uso num cronograma não podem ser apagados (RESTRICT)", () => {
    expect(() => sql(`DELETE FROM "tipos_os" WHERE "id" = 'to1'`)).toThrow(/pmoc_cronogramas_tipo_os_id_fkey/);
    expect(() => sql(`DELETE FROM "tipos_equipamento_custom" WHERE "id" = 'te1'`)).toThrow(/pmoc_cronogramas_tipo_equipamento_id_fkey/);
  });

  it("apagar o equipamento leva as execuções dele; apagar o plano leva o cronograma e as execuções — e NENHUMA OS", () => {
    sql(`DELETE FROM "equipamentos" WHERE "id" = 'q2'`);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "pmoc_execucoes"`)).toBe("x1,x4,x5");
    sql(`DELETE FROM "pmocs" WHERE "id" = 'p1'`);
    expect(sql(`SELECT count(*) FROM "pmoc_execucoes"`)).toBe("0");
    expect(sql(`SELECT string_agg("id", ',') FROM "pmoc_cronogramas"`)).toBe("i3");
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "ordens_servico"`)).toBe("os1");
  });

  it("é só aditivo: duas tabelas novas numa transação; sem enum, sem coluna em tabela existente, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect([...fonte.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z_]+)"/g)].map((m) => m[1])).toEqual(["pmoc_cronogramas", "pmoc_execucoes"]);
    expect(fonte.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(fonte.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g)).toHaveLength(8);
    expect(fonte.match(/CREATE (?:UNIQUE )?INDEX/g)).toHaveLength(8);
    expect(fonte).not.toMatch(/CREATE TYPE|ALTER TYPE|ADD VALUE|ADD COLUMN/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    // As únicas tabelas alteradas são as duas novas (para receber as chaves estrangeiras)
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual(["pmoc_cronogramas", "pmoc_execucoes"]);
    expect(fonte.replace(/ON DELETE (CASCADE|RESTRICT|SET NULL) ON UPDATE CASCADE/g, "")).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
  });

  it("o schema do Prisma aponta para as mesmas tabelas; nas tabelas existentes só entram relações inversas (sem coluna)", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model PmocCronograma \{[\s\S]*?intervaloMeses\s+Int\s+@default\(1\)\s+@map\("intervalo_meses"\)[\s\S]*?@@map\("pmoc_cronogramas"\)/);
    expect(schema).toMatch(/model PmocExecucao \{[\s\S]*?@@unique\(\[cronogramaId, equipamentoId, periodo\]\)[\s\S]*?@@map\("pmoc_execucoes"\)/);
    const inversas = [...schema.matchAll(/^\s+(\w+)\s+(PmocCronograma|PmocExecucao)\[\]$/gm)].map((m) => `${m[1]}:${m[2]}`).sort();
    expect(inversas).toEqual([
      "cronograma:PmocCronograma", "execucoes:PmocExecucao", "execucoes:PmocExecucao", "pmocCronogramas:PmocCronograma", "pmocCronogramas:PmocCronograma",
      "pmocCronogramas:PmocCronograma", "pmocExecucoes:PmocExecucao", "pmocExecucoes:PmocExecucao",
    ]);
  });
});
