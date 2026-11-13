/**
 * ACEITE DO CLIENTE — o SQL da AVALIAÇÃO (prisma/sql/2026-12-30_os_aceite_avaliacao.sql) rodado de
 * verdade num PostgreSQL descartável, POR CIMA do banco como ele está em produção hoje (os arquivos de
 * 2026-12-28 e 2026-12-29 já aplicados, com aceites gravados e uma ressalva):
 *  - cria DUAS colunas em "os_aceites" (a nota e o comentário), UMA regra (nota de 1 a 5) e UMA coluna
 *    em "configuracoes" (a opção por empresa) — e mais nada;
 *  - a opção "Pedir avaliação do cliente" nasce LIGADA, inclusive nas empresas que já existem;
 *  - os aceites que já existem ficam como estão, sem nota; a ressalva (coluna "observacao") não é tocada;
 *  - a nota aceita 1 a 5 ou vazio; 0, 6 e negativo são recusados pelo próprio banco;
 *  - é idempotente (roda três vezes), inclusive com notas já gravadas e a opção desligada por uma empresa;
 *  - os três arquivos juntos dão o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-os-aceite-avaliacao
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ANTERIORES = ["2026-12-28_os_aceite_cliente.sql", "2026-12-29_os_aceite_visto.sql"].map((f) => path.join(RAIZ, "prisma/sql", f));
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-30_os_aceite_avaliacao.sql");
const SCHEMA = `teste_aceite_aval_${process.pid}`;
const PRISMA = `teste_aceite_aval_prisma_${process.pid}`;
const T = "os_aceites";
const REGRA = "os_aceites_avaliacao_check";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção hoje: o que o aceite referencia e as configurações de duas empresas */
const BASE = `
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ABERTA');
  CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "titulo" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "contatos_cliente" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE, "os_exigir_foto" BOOLEAN NOT NULL DEFAULT false);
  INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1', 'CONCLUIDA'), ('os2', 'OS-2', 'CONCLUIDA'), ('os3', 'OS-3', 'CONCLUIDA'), ('os4', 'OS-4', 'CONCLUIDA');
  INSERT INTO "configuracoes" VALUES ('cfg1', 'e1', true), ('cfg2', 'e2', false);
`;
const JA_GRAVADOS = `
  UPDATE "configuracoes" SET "portal_aceite_obrigatorio" = true WHERE "empresa_id" = 'e2';
  INSERT INTO "${T}" ("id", "empresa_id", "ordem_servico_id", "token", "atualizado_em") VALUES ('pend', 'e1', 'os1', 'tok-1', '2026-11-12 15:00');
  INSERT INTO "${T}" ("id", "empresa_id", "ordem_servico_id", "token", "situacao", "metodo", "nome", "observacao", "ip", "confirmado_em", "visto_em", "atualizado_em")
    VALUES ('conf', 'e1', 'os2', 'tok-2', 'CONFIRMADO', 'REMOTO', 'Roberto Almeida', 'O split ainda pinga', '200.150.10.5', '2026-11-12 14:32', '2026-11-12 16:00', '2026-11-12 16:00');
`;
const colunas = (schema: string, tabela = T) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${T}' ORDER BY indexname`);
const chaves = (schema: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${T}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`);
const nomes = (tabela: string) => sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}'`);
const antigos = () => sql(`SELECT string_agg(concat_ws('|', "id", "situacao", coalesce("metodo", '-'), coalesce("nome", '-'), coalesce("observacao", '-'), coalesce("ip", '-'), coalesce("confirmado_em"::text, '-'), coalesce("visto_em"::text, '-'), "atualizado_em"::text), ';' ORDER BY "id") FROM "${T}" WHERE "id" IN ('pend', 'conf')`);
const notas = () => sql(`SELECT string_agg("id" || ':' || coalesce("avaliacao"::text, '-') || ':' || coalesce("avaliacao_comentario", '-'), ',' ORDER BY "id") FROM "${T}"`);
const opcoes = () => sql(`SELECT string_agg("empresa_id" || ':' || "aceite_pedir_avaliacao", ',' ORDER BY "empresa_id") FROM "configuracoes"`);
const semRegra = (t: string) => t.split("\n").filter((l) => !l.startsWith(`${REGRA} `)).join("\n");

describe.skipIf(!URL)("SQL de produção: avaliação do cliente no aceite (PostgreSQL real)", () => {
  let antes = { tabelas: "", colunas: "", config: "", linhas: "", indices: "", chaves: "", outras: "" };
  const outras = () => ["ordens_servico", "atividades_os", "usuarios", "contatos_cliente"].map((t) => `${t}=${nomes(t)}`).join(";");

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    for (const f of ANTERIORES) psql(["-f", f]);
    sql(JA_GRAVADOS);
    antes = { tabelas: tabelas(), colunas: nomes(T), config: nomes("configuracoes"), linhas: antigos(), indices: indices(SCHEMA), chaves: chaves(SCHEMA), outras: outras() };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria DUAS colunas em os_aceites, UMA regra e UMA coluna em configuracoes — e mais nada: nenhuma tabela, índice ou chave nova", () => {
    expect(tabelas()).toBe(antes.tabelas);
    expect(nomes(T)).toBe(`${antes.colunas},avaliacao,avaliacao_comentario`);
    expect(nomes("configuracoes")).toBe(`${antes.config},aceite_pedir_avaliacao`);
    const col = (nome: string) => colunas(SCHEMA).split("\n").find((l) => l.startsWith(`${nome} `));
    expect(col("avaliacao")).toBe("avaliacao integer int4 YES - -");                 // opcional, sem padrão: vazio = confirmou sem avaliar
    expect(col("avaliacao_comentario")).toBe("avaliacao_comentario text text YES - -");
    expect(indices(SCHEMA)).toBe(antes.indices);
    expect(semRegra(chaves(SCHEMA))).toBe(antes.chaves);
    expect(chaves(SCHEMA).split("\n").filter((l) => l.startsWith(`${REGRA} `))).toEqual([`${REGRA} CHECK (((avaliacao IS NULL) OR ((avaliacao >= 1) AND (avaliacao <= 5))))`]);
    expect(outras()).toBe(antes.outras);
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typtype = 'e'`)).toBe("0"); // sem enum
  });

  it("a opção 'Pedir avaliação do cliente' nasce LIGADA — nas empresas que já existem e nas novas — e não aceita vazio", () => {
    expect(opcoes()).toBe("e1:true,e2:true");
    expect(colunas(SCHEMA, "configuracoes").split("\n").find((l) => l.startsWith("aceite_pedir_avaliacao "))).toBe("aceite_pedir_avaliacao boolean bool NO true -");
    expect(sql(`INSERT INTO "configuracoes" ("id", "empresa_id") VALUES ('cfg3', 'e3') RETURNING "aceite_pedir_avaliacao"`)).toBe("t");
    expect(() => sql(`UPDATE "configuracoes" SET "aceite_pedir_avaliacao" = NULL WHERE "empresa_id" = 'e3'`)).toThrow(/null value in column/);
    // As outras opções das empresas não mudam (a do portal continua como cada uma deixou)
    expect(sql(`SELECT string_agg("empresa_id" || ':' || "portal_aceite_obrigatorio" || ':' || "os_exigir_foto", ',' ORDER BY "empresa_id") FROM "configuracoes"`)).toBe("e1:false:true,e2:true:false,e3:false:false");
  });

  it("os aceites que já existem ficam como estão: sem nota e sem comentário; a ressalva (coluna 'observacao') não é tocada", () => {
    expect(antigos()).toBe(antes.linhas);
    expect(antigos()).toContain("conf|CONFIRMADO|REMOTO|Roberto Almeida|O split ainda pinga|200.150.10.5|2026-11-12 14:32:00|2026-11-12 16:00:00|2026-11-12 16:00:00");
    expect(notas()).toBe("conf:-:-,pend:-:-");
  });

  it("a nota é de 1 a 5 (ou vazia): o próprio banco recusa 0, 6 e negativo — o comentário é texto livre, à parte da ressalva", () => {
    const novo = (id: string, os: string, nota: string) => sql(`INSERT INTO "${T}" ("id", "empresa_id", "ordem_servico_id", "token", "situacao", "avaliacao", "atualizado_em") VALUES ('${id}', 'e1', '${os}', 'tok-${id}', 'CONFIRMADO', ${nota}, now()) RETURNING coalesce("avaliacao"::text, 'vazia')`);
    expect(novo("n5", "os3", "5")).toBe("5");
    expect(novo("nvazia", "os4", "NULL")).toBe("vazia");
    for (const nota of [1, 2, 3, 4, 5]) expect(sql(`UPDATE "${T}" SET "avaliacao" = ${nota} WHERE "id" = 'n5' RETURNING "avaliacao"`), String(nota)).toBe(String(nota));
    for (const ruim of [0, 6, -1, 100]) expect(() => sql(`UPDATE "${T}" SET "avaliacao" = ${ruim} WHERE "id" = 'n5'`), String(ruim)).toThrow(new RegExp(REGRA));
    expect(() => sql(`UPDATE "${T}" SET "avaliacao" = 'cinco' WHERE "id" = 'n5'`)).toThrow(/invalid input syntax for type integer/);
    sql(`UPDATE "${T}" SET "avaliacao" = 4, "avaliacao_comentario" = 'Equipe pontual', "observacao" = 'Faltou a tampa do dreno' WHERE "id" = 'n5'`);
    expect(sql(`SELECT "avaliacao" || '|' || "avaliacao_comentario" || '|' || "observacao" FROM "${T}" WHERE "id" = 'n5'`)).toBe("4|Equipe pontual|Faltou a tampa do dreno");
  });

  it("é IDEMPOTENTE: rodar de novo (três vezes) não dá erro e não muda nada — nem as notas gravadas nem a opção que uma empresa desligou", () => {
    sql(`UPDATE "configuracoes" SET "aceite_pedir_avaliacao" = false WHERE "empresa_id" = 'e2'`);
    const retrato = () => [tabelas(), colunas(SCHEMA), indices(SCHEMA), chaves(SCHEMA), colunas(SCHEMA, "configuracoes"), antigos(), notas(), opcoes()].join("\n---\n");
    const depois = retrato();
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO]);
    expect(retrato()).toBe(depois);
    expect(notas()).toBe("conf:-:-,n5:4:Equipe pontual,nvazia:-:-,pend:-:-");
    expect(opcoes()).toBe("e1:true,e2:false,e3:true"); // quem desligou continua desligado
    expect(chaves(SCHEMA).split("\n").filter((l) => l.startsWith(`${REGRA} `))).toHaveLength(1); // a regra não é criada em dobro
  });

  it("o arquivo só ACRESCENTA: três colunas e uma regra, cada uma com a sua guarda — sem apagar, alterar, preencher ou criar enum", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte).not.toMatch(/CREATE TYPE|ALTER TYPE|DROP |TRUNCATE|DELETE |UPDATE |ALTER COLUMN|RENAME|INSERT |CREATE TABLE|CREATE (UNIQUE )?INDEX/);
    expect(fonte.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(3);
    expect(fonte.match(/ADD COLUMN/g)).toHaveLength(3);
    expect(fonte.match(/ADD CONSTRAINT/g)).toHaveLength(1);
    expect(fonte).toMatch(new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conname = '${REGRA}'`));
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]))].sort()).toEqual(["configuracoes", T]);
    expect(fonte).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/m);
    // A ressalva continua onde estava: o arquivo não cita a coluna dela
    expect(fonte).not.toMatch(/observacao|ressalva/);
  });

  it("os três arquivos juntos dão EXATAMENTE o que o Prisma espera (a regra da nota é só do banco: o Prisma não a descreve)", () => {
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    for (const f of [colunas, indices]) expect(f(SCHEMA)).toBe(f(PRISMA));
    expect(semRegra(chaves(SCHEMA))).toBe(chaves(PRISMA));
    const opcao = (schema: string) => colunas(schema, "configuracoes").split("\n").find((l) => l.startsWith("aceite_pedir_avaliacao "));
    expect(opcao(SCHEMA)).toBe(opcao(PRISMA));
    expect(opcao(PRISMA)).toBe("aceite_pedir_avaliacao boolean bool NO true -");
  }, 180_000);
});
