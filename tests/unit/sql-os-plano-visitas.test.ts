/**
 * OS EM CAMPANHA: o SQL de produção (prisma/sql/2026-12-20_os_plano_visitas.sql) rodado de verdade
 * num PostgreSQL descartável, POR CIMA de um banco que já tem OS e atividades gravadas:
 *  - cria UMA tabela ("os_planos_visitas") e UMA coluna ("atividades_os"."plano_visitas_id") — e mais nada;
 *  - é idempotente (roda três vezes) e não mexe no que já está gravado (as atividades ficam sem plano);
 *  - um plano por OS; apagar a OS apaga o plano; apagar o plano solta as atividades (não as apaga);
 *  - não cria nem altera enum;
 *  - o resultado é EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-os-plano-visitas
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-20_os_plano_visitas.sql");
const SCHEMA = `teste_visitas_sql_${process.pid}`;
const PRISMA = `teste_visitas_sql_prisma_${process.pid}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** As tabelas que o arquivo toca, como já existem em produção (só o necessário), com dados gravados */
const BASE = `
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'AGENDADA');
  CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "ordem_servico_id" TEXT NOT NULL REFERENCES "ordens_servico"("id") ON DELETE CASCADE,
    "titulo" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'AGENDADA', "data_agendada" TIMESTAMP(3));
  INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1'), ('os2', 'OS-2');
  INSERT INTO "atividades_os" VALUES ('a1', 'e1', 'os1', 'Limpeza Química', 'AGENDADA', '2026-11-12 15:00'), ('a2', 'e1', 'os1', 'Vistoria', 'CONCLUIDA', '2026-11-13 15:00'), ('a3', 'e1', 'os2', 'Preventiva', 'AGENDADA', NULL);
`;
const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string, filtro = "") => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ${filtro} ORDER BY indexname`);
const chaves = (schema: string, tabela: string, filtro = "") => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ${filtro} ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`);
const nomesDasColunas = (tabela: string) => sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}'`);
const atividades = () => sql(`SELECT string_agg("id" || '|' || "ordem_servico_id" || '|' || "titulo" || '|' || "status" || '|' || coalesce("data_agendada"::text, '-') || '|' || coalesce("plano_visitas_id", '-'), ';' ORDER BY "id") FROM "atividades_os"`);
const plano = (id: string, os: string) => sql(`INSERT INTO "os_planos_visitas" ("id", "empresa_id", "ordem_servico_id", "por_dia", "atualizado_em") VALUES ('${id}', 'e1', '${os}', 25, now()) RETURNING "id" || '|' || "pular_fim_semana"`);

describe.skipIf(!URL)("SQL de produção: OS em campanha, plano de visitas (PostgreSQL real)", () => {
  let colunasDaOs = "";

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    colunasDaOs = nomesDasColunas("ordens_servico");
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria UMA tabela e UMA coluna, e mais nada: as atividades que já existiam ficam como estavam, sem plano", () => {
    expect(tabelas()).toBe("atividades_os,ordens_servico,os_planos_visitas");
    expect(nomesDasColunas("atividades_os")).toBe("id,empresa_id,ordem_servico_id,titulo,status,data_agendada,plano_visitas_id");
    expect(nomesDasColunas("ordens_servico")).toBe(colunasDaOs);
    expect(nomesDasColunas("os_planos_visitas")).toBe("id,empresa_id,ordem_servico_id,por_dia,pular_fim_semana,criado_por_id,criado_em,atualizado_em");
    expect(atividades()).toBe("a1|os1|Limpeza Química|AGENDADA|2026-11-12 15:00:00|-;a2|os1|Vistoria|CONCLUIDA|2026-11-13 15:00:00|-;a3|os2|Preventiva|AGENDADA|-|-");
  });

  it("é IDEMPOTENTE: rodar de novo (três vezes) não dá erro e não muda nada — nem com plano e visitas já gravados", () => {
    expect(plano("p1", "os1")).toBe("p1|true"); // pular fim de semana é o padrão
    sql(`UPDATE "atividades_os" SET "plano_visitas_id" = 'p1' WHERE "id" = 'a1'`);
    const retrato = () => [tabelas(), colunas(SCHEMA, "os_planos_visitas"), indices(SCHEMA, "os_planos_visitas"), chaves(SCHEMA, "os_planos_visitas"), indices(SCHEMA, "atividades_os"), chaves(SCHEMA, "atividades_os"), atividades(),
      sql(`SELECT string_agg("id" || '|' || "por_dia", ';') FROM "os_planos_visitas"`)].join("\n---\n");
    const antes = retrato();
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO]);
    expect(retrato()).toBe(antes);
  });

  it("um plano por OS (chave única); a atividade só aponta para plano que existe", () => {
    expect(() => plano("p1b", "os1")).toThrow(/os_planos_visitas_ordem_servico_id_key/);
    expect(plano("p2", "os2")).toBe("p2|true");
    expect(() => sql(`UPDATE "atividades_os" SET "plano_visitas_id" = 'nao-existe' WHERE "id" = 'a3'`)).toThrow(/atividades_os_plano_visitas_id_fkey/);
    expect(() => plano("p9", "os-que-nao-existe")).toThrow(/os_planos_visitas_ordem_servico_id_fkey/);
  });

  it("apagar o PLANO solta as atividades (continuam existindo, sem plano); apagar a OS apaga o plano dela", () => {
    sql(`UPDATE "atividades_os" SET "plano_visitas_id" = 'p2' WHERE "id" = 'a3'`);
    sql(`DELETE FROM "os_planos_visitas" WHERE "id" = 'p2'`);
    expect(sql(`SELECT "id" || '|' || coalesce("plano_visitas_id", '-') FROM "atividades_os" WHERE "id" = 'a3'`)).toBe("a3|-");
    sql(`DELETE FROM "ordens_servico" WHERE "id" = 'os1'`);
    expect(sql(`SELECT count(*) FROM "os_planos_visitas"`)).toBe("0");
  });

  it("não cria enum, não apaga nem altera nada, e cada criação tem a sua guarda de idempotência", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    // "ON DELETE …" e "ON UPDATE …" são regras das chaves estrangeiras, não comandos
    expect(fonte).not.toMatch(/CREATE TYPE|ALTER TYPE|DROP |TRUNCATE|(?<!ON )DELETE |(?<!ON )UPDATE |ALTER COLUMN|RENAME/);
    const criacoes = fonte.match(/^\s*(CREATE (UNIQUE )?(TABLE|INDEX)|ALTER TABLE .* ADD COLUMN)/gm) ?? [];
    expect(criacoes).toHaveLength(5);
    expect(fonte.match(/IF NOT EXISTS/g)!.length).toBe(5 + 2); // tabela, coluna, 3 índices + as 2 chaves estrangeiras
    expect(fonte).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/m);
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typtype = 'e'`)).toBe("0");
  });

  it("o resultado é EXATAMENTE o que o Prisma espera: a tabela nova e a coluna, o índice e a chave da atividade", () => {
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    for (const f of [colunas, indices, chaves]) expect(f(SCHEMA, "os_planos_visitas")).toBe(f(PRISMA, "os_planos_visitas"));
    const coluna = (schema: string) => colunas(schema, "atividades_os").split("\n").find((l) => l.startsWith("plano_visitas_id "));
    expect(coluna(SCHEMA)).toBe(coluna(PRISMA));
    expect(coluna(SCHEMA)).toBe("plano_visitas_id text text YES - -");
    expect(indices(SCHEMA, "atividades_os", "AND indexname LIKE '%plano_visitas%'")).toBe(indices(PRISMA, "atividades_os", "AND indexname LIKE '%plano_visitas%'"));
    expect(chaves(SCHEMA, "atividades_os", "AND conname LIKE '%plano_visitas%'")).toBe(chaves(PRISMA, "atividades_os", "AND conname LIKE '%plano_visitas%'"));
    expect(chaves(SCHEMA, "atividades_os", "AND conname LIKE '%plano_visitas%'")).toBe("atividades_os_plano_visitas_id_fkey FOREIGN KEY (plano_visitas_id) REFERENCES os_planos_visitas(id) ON UPDATE CASCADE ON DELETE SET NULL");
  }, 180_000);
});
