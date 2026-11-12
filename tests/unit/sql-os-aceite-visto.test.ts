/**
 * ACEITE DO CLIENTE — o SQL do sino (prisma/sql/2026-12-29_os_aceite_visto.sql) rodado de verdade
 * num PostgreSQL descartável, POR CIMA do banco como ele está em produção hoje (o arquivo de
 * 2026-12-28 já aplicado, com aceites gravados):
 *  - cria UMA coluna ("os_aceites"."visto_em"), opcional e sem padrão — e mais nada;
 *  - os aceites que já existem ficam como estão (a observação gravada continua: ela é a ressalva);
 *  - é idempotente (roda três vezes), inclusive depois de um aceite já ter sido visto;
 *  - NÃO apaga a coluna do toggle que saiu da tela ("configuracoes"."os_exigir_assinatura");
 *  - os dois arquivos juntos dão EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-os-aceite-visto
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ANTERIOR = path.join(RAIZ, "prisma/sql/2026-12-28_os_aceite_cliente.sql");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-29_os_aceite_visto.sql");
const SCHEMA = `teste_aceite_visto_${process.pid}`;
const PRISMA = `teste_aceite_visto_prisma_${process.pid}`;
const T = "os_aceites";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção hoje: as tabelas que o aceite referencia, a configuração (com o toggle antigo ligado numa empresa) e o aceite já no ar */
const BASE = `
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ABERTA');
  CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "titulo" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "contatos_cliente" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE, "os_exigir_assinatura" BOOLEAN NOT NULL DEFAULT false);
  INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1', 'CONCLUIDA'), ('os2', 'OS-2', 'CONCLUIDA'), ('os3', 'OS-3', 'CONCLUIDA');
  INSERT INTO "configuracoes" VALUES ('cfg1', 'e1', true), ('cfg2', 'e2', false);
`;
const JA_GRAVADOS = `
  INSERT INTO "${T}" ("id", "empresa_id", "ordem_servico_id", "token", "atualizado_em") VALUES ('pend', 'e1', 'os1', 'tok-1', '2026-11-12 15:00');
  INSERT INTO "${T}" ("id", "empresa_id", "ordem_servico_id", "token", "situacao", "metodo", "nome", "observacao", "ip", "confirmado_em", "atualizado_em")
    VALUES ('conf', 'e1', 'os2', 'tok-2', 'CONFIRMADO', 'REMOTO', 'Roberto Almeida', 'O split ainda pinga', '200.150.10.5', '2026-11-12 14:32', '2026-11-12 14:32');
`;
const colunas = (schema: string, tabela = T) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${T}' ORDER BY indexname`);
const chaves = (schema: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${T}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`);
const nomes = (tabela: string) => sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}'`);
const linhas = () => sql(`SELECT string_agg(concat_ws('|', "id", "situacao", coalesce("metodo", '-'), coalesce("nome", '-'), coalesce("observacao", '-'), coalesce("ip", '-'), coalesce("confirmado_em"::text, '-'), "atualizado_em"::text), ';' ORDER BY "id") FROM "${T}"`);
const vistos = () => sql(`SELECT string_agg("id" || ':' || coalesce("visto_em"::text, '-'), ',' ORDER BY "id") FROM "${T}"`);

describe.skipIf(!URL)("SQL de produção: aviso do aceite no sino (PostgreSQL real)", () => {
  let antes = { tabelas: "", colunas: "", linhas: "", indices: "", chaves: "", config: "" };

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    psql(["-f", ANTERIOR]);
    sql(JA_GRAVADOS);
    antes = { tabelas: tabelas(), colunas: nomes(T), linhas: linhas(), indices: indices(SCHEMA), chaves: chaves(SCHEMA), config: `${nomes("configuracoes")} / ${sql(`SELECT string_agg("empresa_id" || ':' || "os_exigir_assinatura", ',' ORDER BY "empresa_id") FROM "configuracoes"`)}` };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria UMA coluna em os_aceites — opcional, sem padrão — e mais nada: nenhuma tabela, índice ou chave nova", () => {
    expect(tabelas()).toBe(antes.tabelas);
    expect(nomes(T)).toBe(`${antes.colunas},visto_em`);
    expect(colunas(SCHEMA).split("\n").find((l) => l.startsWith("visto_em "))).toBe("visto_em timestamp without time zone timestamp YES - 3");
    expect(indices(SCHEMA)).toBe(antes.indices);
    expect(chaves(SCHEMA)).toBe(antes.chaves);
    for (const t of ["ordens_servico", "atividades_os", "usuarios", "contatos_cliente"]) expect(nomes(t), t).toBe(t === "ordens_servico" ? "id,numero,status" : t === "atividades_os" ? "id,titulo" : "id,nome");
  });

  it("os aceites que já existem ficam como estão: nada é reescrito, a observação gravada continua (é a ressalva) e ninguém nasce 'visto'", () => {
    expect(linhas()).toBe(antes.linhas);
    expect(linhas()).toContain("conf|CONFIRMADO|REMOTO|Roberto Almeida|O split ainda pinga|200.150.10.5|2026-11-12 14:32:00|2026-11-12 14:32:00");
    expect(vistos()).toBe("conf:-,pend:-"); // vazio = o aviso ainda está no sino
    // Um aceite novo também nasce sem "visto"
    sql(`INSERT INTO "${T}" ("id", "empresa_id", "ordem_servico_id", "token", "atualizado_em") VALUES ('novo', 'e1', 'os3', 'tok-3', '2026-11-12 16:00')`);
    expect(vistos()).toBe("conf:-,novo:-,pend:-");
  });

  it("o toggle que saiu da tela NÃO é apagado do banco: a coluna e os valores continuam (limpeza fica para depois)", () => {
    expect(`${nomes("configuracoes").replace(",portal_aceite_obrigatorio", "")} / ${sql(`SELECT string_agg("empresa_id" || ':' || "os_exigir_assinatura", ',' ORDER BY "empresa_id") FROM "configuracoes"`)}`)
      .toBe("id,empresa_id,os_exigir_assinatura / e1:true,e2:false");
    expect(antes.config).toBe("id,empresa_id,os_exigir_assinatura,portal_aceite_obrigatorio / e1:true,e2:false");
  });

  it("é IDEMPOTENTE: rodar de novo (três vezes) não dá erro e não desfaz um 'visto' já gravado", () => {
    sql(`UPDATE "${T}" SET "visto_em" = '2026-11-12 17:05:00' WHERE "id" = 'conf'`);
    const retrato = () => [tabelas(), colunas(SCHEMA), indices(SCHEMA), chaves(SCHEMA), linhas(), vistos(), colunas(SCHEMA, "configuracoes")].join("\n---\n");
    const depois = retrato();
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO]);
    expect(retrato()).toBe(depois);
    expect(vistos()).toBe("conf:2026-11-12 17:05:00,novo:-,pend:-");
  });

  it("o arquivo só ACRESCENTA: uma única instrução, com a guarda de idempotência — sem apagar, alterar ou preencher nada", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
    expect(fonte).toBe('ALTER TABLE "os_aceites" ADD COLUMN IF NOT EXISTS "visto_em" TIMESTAMP(3);');
    expect(fonte).not.toMatch(/DROP |DELETE |UPDATE |TRUNCATE|ALTER COLUMN|RENAME|INSERT |CREATE TYPE|NOT NULL|DEFAULT/);
  });

  it("os dois arquivos juntos dão EXATAMENTE o que o Prisma espera de os_aceites (a ressalva mora na coluna 'observacao')", () => {
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    for (const f of [colunas, indices, chaves]) expect(f(SCHEMA)).toBe(f(PRISMA));
    // O Prisma chama o campo de `ressalva`, mas a coluna continua "observacao": não há coluna "ressalva" em lugar nenhum
    expect(colunas(PRISMA)).toContain("observacao text text YES - -");
    expect(colunas(PRISMA)).not.toMatch(/^ressalva /m);
    expect(colunas(PRISMA)).toContain("visto_em timestamp without time zone timestamp YES - 3");
    // A coluna do toggle continua no schema (sem uso), igual ao banco: nenhum desencontro entre os dois
    expect(colunas(PRISMA, "configuracoes")).toContain("os_exigir_assinatura boolean bool NO false -");
  }, 180_000);
});
