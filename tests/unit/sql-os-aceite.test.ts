/**
 * ACEITE DO CLIENTE na OS: o SQL de produção (prisma/sql/2026-12-28_os_aceite_cliente.sql) rodado de
 * verdade num PostgreSQL descartável, POR CIMA de um banco que já tem OS concluídas e configurações:
 *  - cria UMA tabela ("os_aceites") e UMA coluna ("configuracoes"."portal_aceite_obrigatorio") — e mais nada;
 *  - a opção da empresa nasce DESLIGADA em quem já existe (o portal só avisa, não bloqueia);
 *  - as OS que já estavam concluídas NÃO ganham aceite: não viram pendência de ninguém;
 *  - é idempotente (roda três vezes), inclusive com aceites já gravados;
 *  - uma linha por OS e um token por linha; apagar a OS apaga o aceite; apagar atividade, usuário ou
 *    contato só solta a referência (a prova fica);
 *  - não cria nem altera enum (situação e método são TEXTO); "ordens_servico" não é tocada;
 *  - o resultado é EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-os-aceite
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-28_os_aceite_cliente.sql");
/** O arquivo seguinte (a coluna do sino): o schema de hoje é o resultado dos dois, nesta ordem */
const ARQUIVO_VISTO = path.join(RAIZ, "prisma/sql/2026-12-29_os_aceite_visto.sql");
const SCHEMA = `teste_aceite_sql_${process.pid}`;
const PRISMA = `teste_aceite_sql_prisma_${process.pid}`;
const T = "os_aceites";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** As tabelas que o arquivo toca ou referencia, como já existem em produção (só o necessário), com dados */
const ANTIGAS = ["ordens_servico", "atividades_os", "usuarios", "contatos_cliente", "configuracoes"];
const BASE = `
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ABERTA');
  CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "titulo" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "contatos_cliente" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE, "portal_boas_vindas" TEXT);
  INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1', 'CONCLUIDA'), ('os2', 'OS-2', 'CONCLUIDA'), ('os3', 'OS-3', 'EM_ANDAMENTO');
  INSERT INTO "atividades_os" VALUES ('a1', 'Preventiva');
  INSERT INTO "usuarios" VALUES ('u1', 'Carlos');
  INSERT INTO "contatos_cliente" VALUES ('ct1', 'Maria');
  INSERT INTO "configuracoes" VALUES ('cfg1', 'e1', 'Bem-vindo'), ('cfg2', 'e2', NULL);
`;
const colunas = (schema: string, tabela = T) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${T}' ORDER BY indexname`);
const chaves = (schema: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${T}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`);
const nomes = (tabela: string) => sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}'`);
/** Grava um aceite só com o obrigatório (mais o que o teste pedir) e devolve os padrões que o banco pôs */
const aceite = (id: string, os: string, extra: Record<string, string> = {}) => {
  const campos = { id, empresa_id: "e1", ordem_servico_id: os, token: `tok-${id}`, atualizado_em: "2026-11-12 15:00", ...extra };
  return sql(`INSERT INTO "${T}" (${Object.keys(campos).map((c) => `"${c}"`).join(", ")}) VALUES (${Object.values(campos).map((v) => `'${v}'`).join(", ")})
    RETURNING "situacao" || '|' || "envios" || '|' || coalesce("metodo", '-') || '|' || ("criado_em" IS NOT NULL)`);
};
const referencias = (id: string) => sql(`SELECT concat_ws('|', coalesce("atividade_id", '-'), coalesce("colhido_por_id", '-'), coalesce("contato_id", '-'), "nome", "situacao") FROM "${T}" WHERE "id" = '${id}'`);

describe.skipIf(!URL)("SQL de produção: aceite do cliente na OS (PostgreSQL real)", () => {
  let osAntes = "";

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    osAntes = `${nomes("ordens_servico")} / ${sql(`SELECT string_agg("id" || ':' || "status", ',' ORDER BY "id") FROM "ordens_servico"`)}`;
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria UMA tabela e UMA coluna, e mais nada: a OS não é tocada e as OS já concluídas NÃO ganham aceite", () => {
    expect(tabelas()).toBe([...ANTIGAS, T].sort().join(","));
    expect(`${nomes("ordens_servico")} / ${sql(`SELECT string_agg("id" || ':' || "status", ',' ORDER BY "id") FROM "ordens_servico"`)}`).toBe(osAntes);
    for (const t of ["atividades_os", "usuarios", "contatos_cliente"]) expect(nomes(t), t).toBe(t === "atividades_os" ? "id,titulo" : "id,nome");
    expect(nomes("configuracoes")).toBe("id,empresa_id,portal_boas_vindas,portal_aceite_obrigatorio");
    expect(nomes(T)).toBe([
      "id", "empresa_id", "ordem_servico_id", "token", "situacao", "metodo", "nome", "assinatura", "observacao", "ip", "user_agent", "confirmado_em",
      "atividade_id", "colhido_por_id", "contato_id", "enviado_em", "enviado_canal", "enviado_para", "envios", "criado_em", "atualizado_em",
    ].join(","));
    // Nenhuma OS antiga vira pendência: a tabela nasce vazia
    expect(sql(`SELECT count(*) FROM "${T}"`)).toBe("0");
  });

  it("a opção do portal nasce DESLIGADA nas empresas que já existem (só avisa, não bloqueia) e não aceita vazio", () => {
    expect(sql(`SELECT string_agg("empresa_id" || ':' || "portal_aceite_obrigatorio" || ':' || coalesce("portal_boas_vindas", '-'), ',' ORDER BY "empresa_id") FROM "configuracoes"`)).toBe("e1:false:Bem-vindo,e2:false:-");
    expect(colunas(SCHEMA, "configuracoes").split("\n").find((l) => l.startsWith("portal_aceite_obrigatorio "))).toBe("portal_aceite_obrigatorio boolean bool NO false -");
    expect(sql(`INSERT INTO "configuracoes" ("id", "empresa_id") VALUES ('cfg3', 'e3') RETURNING "portal_aceite_obrigatorio"`)).toBe("f");
  });

  it("o aceite nasce PENDENTE, sem método e sem envios; situação e método são TEXTO (nenhum enum)", () => {
    expect(aceite("ac1", "os1")).toBe("PENDENTE|0|-|true");
    expect(sql(`SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${T}' AND column_name IN ('situacao', 'metodo', 'enviado_canal', 'confirmado_em', 'envios')`))
      .toBe("confirmado_em:timestamp without time zone,enviado_canal:text,envios:integer,metodo:text,situacao:text");
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typtype = 'e'`)).toBe("0");
    for (const campo of ["empresa_id", "ordem_servico_id", "token", "situacao", "envios"])
      expect(() => sql(`UPDATE "${T}" SET "${campo}" = NULL WHERE "id" = 'ac1'`), campo).toThrow(/null value in column/);
  });

  it("UMA linha por OS e UM token por linha; só aceita OS, atividade, usuário e contato que existem", () => {
    expect(() => aceite("ac1b", "os1")).toThrow(/os_aceites_ordem_servico_id_key/);
    expect(() => aceite("ac2", "os2", { token: "tok-ac1" })).toThrow(/os_aceites_token_key/);
    expect(aceite("ac2", "os2", { situacao: "CONFIRMADO", metodo: "LOCAL", nome: "João Pereira", atividade_id: "a1", colhido_por_id: "u1", contato_id: "ct1", ip: "189.10.20.30", confirmado_em: "2026-11-12 14:32" })).toBe("CONFIRMADO|0|LOCAL|true");
    expect(() => aceite("x1", "os-que-nao-existe")).toThrow(/os_aceites_ordem_servico_id_fkey/);
    for (const [coluna, chave] of [["atividade_id", "atividade_id"], ["colhido_por_id", "colhido_por_id"], ["contato_id", "contato_id"]])
      expect(() => aceite(`x-${coluna}`, "os3", { [coluna]: "nao-existe" }), coluna).toThrow(new RegExp(`os_aceites_${chave}_fkey`));
  });

  it("é IDEMPOTENTE: rodar de novo (três vezes) não dá erro e não muda nada — nem com aceites já gravados nem com a opção ligada", () => {
    sql(`UPDATE "configuracoes" SET "portal_aceite_obrigatorio" = true WHERE "empresa_id" = 'e2'`);
    const retrato = () => [tabelas(), colunas(SCHEMA), indices(SCHEMA), chaves(SCHEMA), colunas(SCHEMA, "configuracoes"),
      sql(`SELECT string_agg(concat_ws('|', "id", "ordem_servico_id", "token", "situacao", coalesce("metodo", '-'), coalesce("nome", '-'), coalesce("ip", '-')), ';' ORDER BY "id") FROM "${T}"`),
      sql(`SELECT string_agg("empresa_id" || ':' || "portal_aceite_obrigatorio", ',' ORDER BY "empresa_id") FROM "configuracoes"`)].join("\n---\n");
    const antes = retrato();
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO]);
    expect(retrato()).toBe(antes);
    expect(antes).toContain("ac2|os2|tok-ac2|CONFIRMADO|LOCAL|João Pereira|189.10.20.30");
    expect(antes).toContain("e1:false,e2:true,e3:false"); // a opção ligada por uma empresa não volta a desligada
  });

  it("apagar atividade, usuário ou contato só SOLTA a referência (a prova fica); apagar a OS apaga o aceite dela", () => {
    expect(referencias("ac2")).toBe("a1|u1|ct1|João Pereira|CONFIRMADO");
    sql(`DELETE FROM "atividades_os" WHERE "id" = 'a1'; DELETE FROM "usuarios" WHERE "id" = 'u1'; DELETE FROM "contatos_cliente" WHERE "id" = 'ct1'`);
    expect(referencias("ac2")).toBe("-|-|-|João Pereira|CONFIRMADO");
    sql(`DELETE FROM "ordens_servico" WHERE "id" = 'os2'`);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "${T}"`)).toBe("ac1");
  });

  it("não cria enum, não apaga nem altera nada, e cada criação tem a sua guarda de idempotência", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    // "ON DELETE …" e "ON UPDATE …" são regras das chaves estrangeiras, não comandos
    expect(fonte).not.toMatch(/CREATE TYPE|ALTER TYPE|DROP |TRUNCATE|(?<!ON )DELETE |(?<!ON )UPDATE |ALTER COLUMN|RENAME|INSERT /);
    expect(fonte.match(/^\s*(CREATE (UNIQUE )?(TABLE|INDEX)|ALTER TABLE .* ADD COLUMN)/gm)).toHaveLength(5);   // a coluna, a tabela e 3 índices
    expect(fonte.match(/ADD CONSTRAINT/g)).toHaveLength(4);                                                    // as 4 chaves estrangeiras
    expect(fonte.match(/IF NOT EXISTS/g)).toHaveLength(5 + 4);                                                 // cada criação com a sua guarda
    // Só "configuracoes" (a coluna da opção) e a tabela nova são alteradas: "ordens_servico" não é tocada
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]))].sort()).toEqual(["configuracoes", T]);
    expect(fonte).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/m);
  });

  it("o resultado é EXATAMENTE o que o Prisma espera: a tabela nova e a coluna da opção (com o arquivo seguinte, que traz a coluna do sino)", () => {
    psql(["-f", ARQUIVO_VISTO]);
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    for (const f of [colunas, indices, chaves]) expect(f(SCHEMA)).toBe(f(PRISMA));
    const opcao = (schema: string) => colunas(schema, "configuracoes").split("\n").find((l) => l.startsWith("portal_aceite_obrigatorio "));
    expect(opcao(SCHEMA)).toBe(opcao(PRISMA));
    expect(indices(SCHEMA).split("\n")).toHaveLength(4); // a chave primária e os 3 do arquivo
    expect(chaves(SCHEMA)).toContain("os_aceites_ordem_servico_id_fkey FOREIGN KEY (ordem_servico_id) REFERENCES ordens_servico(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(chaves(SCHEMA)).toContain("os_aceites_colhido_por_id_fkey FOREIGN KEY (colhido_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");
  }, 180_000);
});
