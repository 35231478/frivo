/**
 * PMOC — Etapa 3 (documento, alertas e envio): o SQL de produção
 * (prisma/sql/2026-12-15_pmoc_etapa3_documento_alertas_envio.sql) rodado de verdade num PostgreSQL
 * descartável, POR CIMA do banco como ele está depois das Etapas 1, 2 e 2.1 (com planos já gravados):
 *  - acrescenta UMA coluna em "pmocs" ("token_publico") e TRÊS tabelas ("pmoc_historico",
 *    "pmoc_avisos", "pmoc_configuracoes") — e mais nada;
 *  - é idempotente (roda três vezes) e não mexe no que já está gravado;
 *  - a chave única de "pmoc_avisos" é o que impede o mesmo aviso duas vezes;
 *  - não cria nem altera enum;
 *  - o resultado é EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-pmoc-etapa3
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const sqlDe = (nome: string) => path.join(RAIZ, "prisma/sql", nome);
const ANTERIORES = ["2026-10-06_pmoc_etapa1_1_enum.sql", "2026-10-06_pmoc_etapa1_2.sql", "2026-12-10_pmoc_etapa2_cronograma.sql", "2026-12-12_pmoc_cronograma_fim_semana.sql"].map(sqlDe);
const ARQUIVO = sqlDe("2026-12-15_pmoc_etapa3_documento_alertas_envio.sql");
const SCHEMA = `teste_pmoc3_sql_${process.pid}`;
const PRISMA = `teste_pmoc3_sql_prisma_${process.pid}`;
const NOVAS = ["pmoc_historico", "pmoc_avisos", "pmoc_configuracoes"] as const;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** O que o PMOC referencia, como já existe em produção (só o necessário para as chaves) */
const BASE = `
  CREATE TYPE "TratamentoFimSemana" AS ENUM ('MANTER', 'ADIANTAR', 'POSTERGAR');
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "clientes" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "unidades" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY, "nome" TEXT);
  CREATE TABLE "tipos_os" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "tipos_equipamento_custom" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'AGENDADA');
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total'), ('e2', 'Outra');
  INSERT INTO "clientes" VALUES ('c1', 'Hospital');
  INSERT INTO "unidades" VALUES ('u1', 'Matriz');
  INSERT INTO "usuarios" VALUES ('us1', 'Ana'), ('us2', 'Beto');
`;
/** Planos gravados pelas etapas anteriores, ANTES deste arquivo */
const JA_GRAVADO = `
  INSERT INTO "pmocs" ("id", "empresa_id", "cliente_id", "unidade_id", "nome", "data_inicio", "data_expiracao", "status", "art_numero", "atualizado_em") VALUES
    ('p1', 'e1', 'c1', 'u1', 'PMOC 2026', '2026-01-01', '2026-12-31', 'PUBLICADO', '123', '2026-01-01 12:00'),
    ('p2', 'e1', 'c1', 'u1', 'PMOC rascunho', '2026-06-01', '2027-05-31', 'RASCUNHO', NULL, '2026-06-01 12:00');
`;
const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const nomesDasColunas = (tabela: string) => sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}'`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`);
const retratoDosPlanos = () => sql(`SELECT string_agg("id" || '|' || "nome" || '|' || "status" || '|' || "data_expiracao" || '|' || coalesce("art_numero", '-') || '|' || "atualizado_em", ';' ORDER BY "id") FROM "pmocs"`);
const aviso = (id: string, pmoc: string, tipo: string, expira: string) => sql(`INSERT INTO "pmoc_avisos" ("id", "pmoc_id", "tipo", "data_expiracao") VALUES ('${id}', '${pmoc}', '${tipo}', '${expira}') ON CONFLICT DO NOTHING RETURNING "id"`);

describe.skipIf(!URL)("SQL de produção: PMOC — Etapa 3, documento, alertas e envio (PostgreSQL real)", () => {
  let antes = "", tabelasAntes = "", colunasAntes: Record<string, string> = {};
  const OUTRAS = ["pmoc_equipamentos", "pmoc_cronogramas", "pmoc_execucoes", "empresas", "usuarios", "clientes", "ordens_servico"];

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    for (const arq of ANTERIORES) psql(["-f", arq]);
    sql(JA_GRAVADO);
    antes = retratoDosPlanos(); tabelasAntes = tabelas();
    colunasAntes = Object.fromEntries(OUTRAS.map((t) => [t, nomesDasColunas(t)]));
    expect(nomesDasColunas("pmocs")).not.toContain("token_publico"); // produção antes deste arquivo
    psql(["-f", ARQUIVO]);
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" }); });

  it("acrescenta UMA coluna em 'pmocs' e TRÊS tabelas — nenhuma outra tabela muda", () => {
    expect(nomesDasColunas("pmocs").split(",").at(-1)).toBe("token_publico");
    expect(nomesDasColunas("pmocs").split(",")).toHaveLength(22);
    expect(tabelas().split(",").filter((t) => !tabelasAntes.split(",").includes(t))).toEqual(["pmoc_avisos", "pmoc_configuracoes", "pmoc_historico"]);
    for (const t of OUTRAS) expect(nomesDasColunas(t), t).toBe(colunasAntes[t]);
    expect(nomesDasColunas("pmoc_historico")).toBe("id,pmoc_id,usuario_id,acao,detalhes,criado_em");
    expect(nomesDasColunas("pmoc_avisos")).toBe("id,pmoc_id,tipo,data_expiracao,criado_em,visto_em,visto_por_id");
    expect(nomesDasColunas("pmoc_configuracoes")).toBe("empresa_id,dias_aviso,texto_padrao,atualizado_em");
  });

  it("os planos que JÁ existiam não mudam em nada (nem a data de atualização) e ficam sem link público até o 1º envio", () => {
    expect(retratoDosPlanos()).toBe(antes);
    expect(sql(`SELECT count(*) FROM "pmocs" WHERE "token_publico" IS NOT NULL`)).toBe("0");
    expect(sql(`SELECT (SELECT count(*) FROM "pmoc_historico") + (SELECT count(*) FROM "pmoc_avisos") + (SELECT count(*) FROM "pmoc_configuracoes")`)).toBe("0");
  });

  it("as quatro tabelas ficam IDÊNTICAS às que o Prisma espera — colunas, tipos, padrões, índices e chaves", () => {
    for (const t of ["pmocs", ...NOVAS]) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), t).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), t).toBe(chaves(PRISMA, t));
    }
    expect(colunas(SCHEMA, "pmoc_configuracoes")).toContain("dias_aviso integer int4 NO 30 -");
    expect(chaves(SCHEMA, "pmoc_avisos").split("\n")).toHaveLength(3);    // primária + plano + quem deu ciência
    expect(chaves(SCHEMA, "pmoc_historico").split("\n")).toHaveLength(3); // primária + plano + usuário
  });

  it("IDEMPOTÊNCIA do aviso no banco: o mesmo (plano, tipo, data de expiração) não entra duas vezes; outro tipo e outra data, sim", () => {
    expect(aviso("a1", "p1", "VENCENDO", "2026-12-31")).toBe("a1");
    expect(aviso("a2", "p1", "VENCENDO", "2026-12-31")).toBe("");   // de novo: recusado pela chave única
    expect(aviso("a3", "p1", "EXPIRADO", "2026-12-31")).toBe("a3"); // virou expirado: outro aviso
    expect(aviso("a4", "p1", "VENCENDO", "2027-12-31")).toBe("a4"); // a validade mudou: outro aviso
    expect(aviso("a5", "p2", "VENCENDO", "2026-12-31")).toBe("a5"); // outro plano
    expect(() => sql(`INSERT INTO "pmoc_avisos" ("id", "pmoc_id", "tipo", "data_expiracao") VALUES ('a9', 'p1', 'VENCENDO', '2026-12-31')`)).toThrow(/pmoc_avisos_pmoc_id_tipo_data_expiracao_key/);
    expect(sql(`SELECT "visto_em" IS NULL FROM "pmoc_avisos" WHERE "id" = 'a1'`)).toBe("t"); // nasce sem ciência
  });

  it("link público: o token é único entre os planos, mas vários planos podem ficar sem token", () => {
    sql(`UPDATE "pmocs" SET "token_publico" = 'tok-1' WHERE "id" = 'p1'`);
    expect(() => sql(`UPDATE "pmocs" SET "token_publico" = 'tok-1' WHERE "id" = 'p2'`)).toThrow(/pmocs_token_publico_key/);
    sql(`UPDATE "pmocs" SET "token_publico" = NULL WHERE "id" = 'p1'`);
    expect(sql(`SELECT count(*) FROM "pmocs" WHERE "token_publico" IS NULL`)).toBe("2");
    sql(`UPDATE "pmocs" SET "token_publico" = 'tok-1' WHERE "id" = 'p1'`);
  });

  it("configuração: uma linha por empresa, 30 dias por padrão; empresa inexistente é recusada", () => {
    sql(`INSERT INTO "pmoc_configuracoes" ("empresa_id", "atualizado_em") VALUES ('e1', now())`);
    expect(sql(`SELECT "dias_aviso" || '|' || coalesce("texto_padrao", 'null') FROM "pmoc_configuracoes"`)).toBe("30|null");
    expect(() => sql(`INSERT INTO "pmoc_configuracoes" ("empresa_id", "atualizado_em") VALUES ('e1', now())`)).toThrow(/pmoc_configuracoes_pkey/);
    expect(() => sql(`INSERT INTO "pmoc_configuracoes" ("empresa_id", "atualizado_em") VALUES ('nao-existe', now())`)).toThrow(/pmoc_configuracoes_empresa_id_fkey/);
  });

  it("IDEMPOTENTE: rodar de novo (duas vezes) não falha e não mexe no que já foi gravado", () => {
    sql(`INSERT INTO "pmoc_historico" ("id", "pmoc_id", "usuario_id", "acao") VALUES ('h1', 'p1', 'us1', 'Documento enviado por WhatsApp'), ('h2', 'p1', NULL, 'Aviso: plano expirado')`);
    sql(`UPDATE "pmoc_avisos" SET "visto_em" = '2026-12-01 10:00', "visto_por_id" = 'us1' WHERE "id" = 'a1'`);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "pmoc_avisos"`)).toBe("a1,a3,a4,a5");
    expect(sql(`SELECT "visto_por_id" FROM "pmoc_avisos" WHERE "id" = 'a1'`)).toBe("us1");
    expect(sql(`SELECT count(*) FROM "pmoc_historico"`)).toBe("2");
    expect(sql(`SELECT "token_publico" FROM "pmocs" WHERE "id" = 'p1'`)).toBe("tok-1");
    expect(sql(`SELECT "dias_aviso" FROM "pmoc_configuracoes" WHERE "empresa_id" = 'e1'`)).toBe("30");
    expect(nomesDasColunas("pmocs").split(",")).toHaveLength(22);
  });

  it("apagar o usuário não apaga o histórico nem a ciência (ficam sem o autor); apagar o plano leva os dois; apagar a empresa leva a configuração", () => {
    sql(`DELETE FROM "usuarios" WHERE "id" = 'us1'`);
    expect(sql(`SELECT string_agg("id" || ':' || coalesce("usuario_id", 'null'), ',' ORDER BY "id") FROM "pmoc_historico"`)).toBe("h1:null,h2:null");
    expect(sql(`SELECT coalesce("visto_por_id", 'null') || '|' || ("visto_em" IS NOT NULL) FROM "pmoc_avisos" WHERE "id" = 'a1'`)).toBe("null|true");
    sql(`DELETE FROM "pmocs" WHERE "id" = 'p1'`);
    expect(sql(`SELECT count(*) FROM "pmoc_historico"`)).toBe("0");
    expect(sql(`SELECT string_agg("id", ',') FROM "pmoc_avisos"`)).toBe("a5");
    sql(`DELETE FROM "pmocs"; DELETE FROM "empresas" WHERE "id" = 'e1'`);
    expect(sql(`SELECT count(*) FROM "pmoc_configuracoes"`)).toBe("0");
  });

  it("é só aditivo: uma coluna e três tabelas numa transação; sem enum, sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect([...fonte.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z_]+)"/g)].map((m) => m[1])).toEqual(["pmoc_historico", "pmoc_avisos", "pmoc_configuracoes"]);
    expect(fonte.match(/CREATE TABLE/g)).toHaveLength(3);
    expect(fonte.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(1);
    expect(fonte.match(/ADD COLUMN/g)).toHaveLength(1);
    expect(fonte).toContain(`ALTER TABLE "pmocs" ADD COLUMN IF NOT EXISTS "token_publico" TEXT;`);
    expect(fonte.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g)).toHaveLength(3);
    expect(fonte.match(/CREATE (?:UNIQUE )?INDEX/g)).toHaveLength(3);
    expect(fonte).not.toMatch(/CREATE TYPE|ALTER TYPE|ADD VALUE/);
    expect(fonte).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    // As únicas tabelas alteradas: "pmocs" (a coluna nova) e as três novas (para receber as chaves estrangeiras)
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual(["pmoc_avisos", "pmoc_configuracoes", "pmoc_historico", "pmocs"]);
    expect(fonte.replace(/ON DELETE (CASCADE|RESTRICT|SET NULL) ON UPDATE CASCADE/g, "")).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
  });

  it("o schema do Prisma aponta para as mesmas tabelas e a mesma chave única do aviso", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/tokenPublico String\? @unique @map\("token_publico"\)/);
    expect(schema).toMatch(/model PmocAviso \{[\s\S]*?@@unique\(\[pmocId, tipo, dataExpiracao\]\)[\s\S]*?@@map\("pmoc_avisos"\)/);
    expect(schema).toMatch(/model PmocHistorico \{[\s\S]*?@@map\("pmoc_historico"\)/);
    expect(schema).toMatch(/model PmocConfiguracao \{[\s\S]*?diasAviso\s+Int\s+@default\(30\)\s+@map\("dias_aviso"\)[\s\S]*?@@map\("pmoc_configuracoes"\)/);
  });
});
