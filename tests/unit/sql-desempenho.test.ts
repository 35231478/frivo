/**
 * DESEMPENHO (PR 1) — o SQL de produção (prisma/sql/2026-12-31_desempenho.sql) rodado de verdade num
 * PostgreSQL descartável, POR CIMA de um banco "como produção hoje" (as tabelas que ele referencia,
 * com atividades já concluídas):
 *  - cria SETE tabelas e UMA coluna ("atividades_os"."concluida_em") — e mais nada;
 *  - as atividades que já existem ficam como estão, com a data de conclusão VAZIA (sem medição);
 *  - nenhuma tabela existente perde ou muda coluna, linha, índice ou chave;
 *  - as regras do banco valem: uma configuração por empresa, um perfil por colaborador, uma regra por
 *    perfil e mês, um item por fato; apagar em cascata o que é da empresa/OS/colaborador;
 *  - é idempotente (roda três vezes, com dados gravados, sem erro e sem mudar nada);
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-desempenho
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
// Cada conferência é uma chamada ao psql: os testes que fotografam o banco inteiro passam dos 5 s padrão
vi.setConfig({ testTimeout: 60_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-31_desempenho.sql");
const SCHEMA = `teste_desempenho_${process.pid}`;
const PRISMA = `teste_desempenho_prisma_${process.pid}`;
const NOVAS = ["desempenho_config", "desempenho_participantes", "desempenho_penalidades", "desempenho_perfis", "desempenho_premiacoes", "desempenho_regras", "desempenho_tipos_retorno"];
const EXISTENTES = ["atividades_os", "empresas", "equipamentos", "ordens_servico", "tecnicos", "tipos_os", "usuarios"];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção hoje: só o que o arquivo referencia, com uma atividade concluída e uma aberta em cada empresa */
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "tipos_os" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ABERTA');
  CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "ordem_servico_id" TEXT NOT NULL, "titulo" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'AGENDADA', "prazo" DATE, "data_agendada" TIMESTAMP(3));
  CREATE INDEX "atividades_os_status_idx" ON "atividades_os"("status");
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total'), ('e2', 'Outra');
  INSERT INTO "usuarios" VALUES ('u1', 'Ana'), ('u2', 'Beto');
  INSERT INTO "tecnicos" VALUES ('t1', 'e1', 'João'), ('t2', 'e1', 'Maria'), ('t3', 'e2', 'Zé');
  INSERT INTO "tipos_os" VALUES ('to1', 'e1', 'Manutenção Corretiva'), ('to2', 'e1', 'Preventiva');
  INSERT INTO "equipamentos" VALUES ('q1', 'Split da recepção');
  INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1', 'CONCLUIDA'), ('os2', 'OS-2', 'ABERTA');
  INSERT INTO "atividades_os" VALUES ('a1', 'os1', 'Preventiva', 'CONCLUIDA', '2026-11-05', '2026-11-05 12:00'), ('a2', 'os2', 'Corretiva', 'AGENDADA', NULL, '2026-11-20 12:00');
`;
const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`).split(",");
const nomes = (tabela: string) => sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}'`);
const linhas = (tabela: string) => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM "${tabela}" t`);
const retrato = (lista: string[]) => lista.map((t) => `${t}\n${colunas(SCHEMA, t)}\n${indices(SCHEMA, t)}\n${chaves(SCHEMA, t)}\n${linhas(t)}`).join("\n=====\n");

/** Uma empresa inteira configurada: o que as regras do banco precisam para serem exercitadas */
const DADOS = `
  INSERT INTO "desempenho_config" ("id", "empresa_id", "atualizado_em") VALUES ('cfg1', 'e1', now());
  INSERT INTO "desempenho_tipos_retorno" ("id", "empresa_id", "tipo_os_id") VALUES ('tr1', 'e1', 'to1');
  INSERT INTO "desempenho_perfis" ("id", "empresa_id", "nome", "atualizado_em") VALUES ('p1', 'e1', 'Preventiva', now()), ('p2', 'e1', 'Encarregado', now());
  INSERT INTO "desempenho_regras" ("id", "empresa_id", "perfil_id", "vigente_desde", "peso_prazo", "peso_relatorio", "peso_avaliacao", "meta_minima", "faixas")
    VALUES ('r1', 'e1', 'p1', '2026-11', 40, 30, 30, 70, '[{"nome":"Bronze","minimo":70,"valor":100.5}]');
  INSERT INTO "desempenho_participantes" ("id", "empresa_id", "tecnico_id", "perfil_id") VALUES ('pa1', 'e1', 't1', 'p1');
  INSERT INTO "desempenho_penalidades" ("id", "empresa_id", "tecnico_id", "tipo", "chave", "ordem_servico_id", "os_retorno_id", "equipamento_id", "data_fato", "competencia", "revisado_por_id", "criado_por_id", "atualizado_em")
    VALUES ('pe1', 'e1', 't1', 'RETORNO', 'RETORNO:os2:q1:t1', 'os1', 'os2', 'q1', '2026-11-10 12:00', '2026-11', 'u1', 'u2', now());
  INSERT INTO "desempenho_premiacoes" ("id", "empresa_id", "competencia", "titulo", "perfil_id", "atualizado_em") VALUES ('pr1', 'e1', '2026-11', 'Kit de ferramentas', 'p1', now());
`;

describe.skipIf(!URL)("SQL de produção: Desempenho PR 1 (PostgreSQL real)", () => {
  let antes = { tabelas: [] as string[], existentes: "", atividades: "" };

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    antes = { tabelas: tabelas(), existentes: retrato(EXISTENTES.filter((t) => t !== "atividades_os")), atividades: linhas("atividades_os") };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria as SETE tabelas do Desempenho e UMA coluna em atividades_os — e mais nada", () => {
    expect(tabelas()).toEqual([...antes.tabelas, ...NOVAS].sort());
    expect(nomes("atividades_os")).toBe("id,ordem_servico_id,titulo,status,prazo,data_agendada,concluida_em");
    expect(colunas(SCHEMA, "atividades_os").split("\n").find((l) => l.startsWith("concluida_em "))).toBe("concluida_em timestamp without time zone timestamp YES - 3");
    expect(indices(SCHEMA, "atividades_os").split("\n").filter(Boolean)).toHaveLength(2); // a chave primária e o índice que já existia
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typtype = 'e'`)).toBe("0"); // sem enum
  });

  it("as atividades que já existem ficam como estão: a data de conclusão nasce VAZIA (sem medição, nunca uma data inventada)", () => {
    expect(sql(`SELECT string_agg("id" || ':' || "status" || ':' || coalesce("concluida_em"::text, 'vazia'), ',' ORDER BY "id") FROM "atividades_os"`)).toBe("a1:CONCLUIDA:vazia,a2:AGENDADA:vazia");
    // Tirando a coluna nova, as linhas são as mesmas de antes
    expect(linhas("atividades_os").replaceAll(",)", ")")).toBe(antes.atividades);
    sql(`UPDATE "atividades_os" SET "concluida_em" = '2026-11-12 18:30:15.123' WHERE "id" = 'a2'`);
    expect(sql(`SELECT "concluida_em" FROM "atividades_os" WHERE "id" = 'a2'`)).toBe("2026-11-12 18:30:15.123");
    sql(`UPDATE "atividades_os" SET "concluida_em" = NULL WHERE "id" = 'a2'`);
  });

  it("nenhuma tabela existente perde ou muda coluna, linha, índice ou chave", () => {
    expect(retrato(EXISTENTES.filter((t) => t !== "atividades_os"))).toBe(antes.existentes);
  });

  it("as tabelas novas nascem vazias: o módulo só existe para a empresa quando a gestão abre a configuração", () => {
    for (const t of NOVAS) expect(sql(`SELECT count(*) FROM "${t}"`), t).toBe("0");
  });

  it("padrões: retorno em 30 dias, nota baixa até 2, TV desligada, perfil de campo, item nasce 'A_REVISAR', exige foto antes/depois", () => {
    sql(DADOS);
    expect(sql(`SELECT "retorno_dias" || '|' || "nota_baixa_ate" || '|' || coalesce("tv_token", 'desligada') FROM "desempenho_config"`)).toBe("30|2|desligada");
    expect(sql(`SELECT string_agg("nome" || ':' || "tipo" || ':' || "ordem", ',' ORDER BY "nome") FROM "desempenho_perfis"`)).toBe("Encarregado:TECNICO:0,Preventiva:TECNICO:0");
    expect(sql(`SELECT "situacao" || '|' || coalesce("motivo", '-') || '|' || coalesce("revisado_em"::text, '-') FROM "desempenho_penalidades"`)).toBe("A_REVISAR|-|-");
    expect(sql(`SELECT "exigir_foto_antes_depois" || '|' || "penalidade_retorno" || '|' || "penalidade_reclamacao" || '|' || ("faixas"->0->>'valor') FROM "desempenho_regras"`)).toBe("true|0|0|100.5");
  });

  it("as regras do banco: uma configuração por empresa, um perfil por colaborador, uma regra por perfil e mês, um item por fato", () => {
    const recusa = (q: string, regra: RegExp) => expect(() => sql(q), q).toThrow(regra);
    recusa(`INSERT INTO "desempenho_config" ("id", "empresa_id", "atualizado_em") VALUES ('cfgX', 'e1', now())`, /desempenho_config_empresa_id_key/);
    recusa(`INSERT INTO "desempenho_perfis" ("id", "empresa_id", "nome", "atualizado_em") VALUES ('pX', 'e1', 'Preventiva', now())`, /desempenho_perfis_empresa_id_nome_key/);
    recusa(`INSERT INTO "desempenho_participantes" ("id", "empresa_id", "tecnico_id", "perfil_id") VALUES ('paX', 'e1', 't1', 'p2')`, /desempenho_participantes_tecnico_id_key/);
    recusa(`INSERT INTO "desempenho_regras" ("id", "empresa_id", "perfil_id", "vigente_desde", "peso_prazo", "peso_relatorio", "peso_avaliacao", "meta_minima", "faixas") VALUES ('rX', 'e1', 'p1', '2026-11', 1, 1, 1, 1, '[]')`, /desempenho_regras_perfil_id_vigente_desde_key/);
    recusa(`INSERT INTO "desempenho_penalidades" ("id", "empresa_id", "tecnico_id", "tipo", "chave", "data_fato", "competencia", "atualizado_em") VALUES ('peX', 'e1', 't1', 'RETORNO', 'RETORNO:os2:q1:t1', now(), '2026-11', now())`, /desempenho_penalidades_chave_key/);
    recusa(`INSERT INTO "desempenho_tipos_retorno" ("id", "empresa_id", "tipo_os_id") VALUES ('trX', 'e1', 'to1')`, /desempenho_tipos_retorno_empresa_id_tipo_os_id_key/);
    // O mesmo nome de perfil em OUTRA empresa pode; a mesma regra em outro mês também
    sql(`INSERT INTO "desempenho_perfis" ("id", "empresa_id", "nome", "atualizado_em") VALUES ('pE2', 'e2', 'Preventiva', now())`);
    sql(`INSERT INTO "desempenho_regras" ("id", "empresa_id", "perfil_id", "vigente_desde", "peso_prazo", "peso_relatorio", "peso_avaliacao", "meta_minima", "faixas") VALUES ('r2', 'e1', 'p1', '2026-12', 50, 25, 25, 60, '[]')`);
    // Dois links de TV iguais não existem; dois desligados (vazios) sim
    sql(`INSERT INTO "desempenho_config" ("id", "empresa_id", "tv_token", "atualizado_em") VALUES ('cfg2', 'e2', 'tok-1', now())`);
    recusa(`UPDATE "desempenho_config" SET "tv_token" = 'tok-1' WHERE "id" = 'cfg1'`, /desempenho_config_tv_token_key/);
    // Referência que não existe é recusada
    recusa(`INSERT INTO "desempenho_participantes" ("id", "empresa_id", "tecnico_id", "perfil_id") VALUES ('paY', 'e1', 'nao-existe', 'p1')`, /desempenho_participantes_tecnico_id_fkey/);
    recusa(`INSERT INTO "desempenho_participantes" ("id", "empresa_id", "tecnico_id", "perfil_id") VALUES ('paY', 'e1', 't2', 'nao-existe')`, /desempenho_participantes_perfil_id_fkey/);
    recusa(`INSERT INTO "desempenho_tipos_retorno" ("id", "empresa_id", "tipo_os_id") VALUES ('trY', 'e1', 'nao-existe')`, /desempenho_tipos_retorno_tipo_os_id_fkey/);
  });

  it("é IDEMPOTENTE: rodar de novo (três vezes), com tudo gravado, não dá erro e não muda nada", () => {
    sql(`UPDATE "atividades_os" SET "concluida_em" = '2026-11-12 18:30' WHERE "id" = 'a2';
      UPDATE "desempenho_config" SET "retorno_dias" = 45, "nota_baixa_ate" = 3 WHERE "id" = 'cfg1';
      UPDATE "desempenho_penalidades" SET "situacao" = 'CONTA', "motivo" = 'Defeito do serviço anterior', "revisado_em" = '2026-11-12 10:00' WHERE "id" = 'pe1'`);
    const tudo = () => [tabelas().join(","), retrato([...NOVAS, ...EXISTENTES])].join("\n#####\n");
    const depois = tudo();
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO]);
    expect(tudo()).toBe(depois);
    expect(sql(`SELECT "retorno_dias" || '|' || "nota_baixa_ate" FROM "desempenho_config" WHERE "id" = 'cfg1'`)).toBe("45|3"); // o que a empresa ajustou continua
    expect(sql(`SELECT "situacao" || '|' || "motivo" FROM "desempenho_penalidades"`)).toBe("CONTA|Defeito do serviço anterior");
    expect(sql(`SELECT "concluida_em" FROM "atividades_os" WHERE "id" = 'a2'`)).toBe("2026-11-12 18:30:00");
    for (const t of NOVAS) expect(chaves(SCHEMA, t).split("\n").length, t).toBe(new Set(chaves(SCHEMA, t).split("\n")).size); // nenhuma chave em dobro
  });

  it("apagar em cascata o que é da OS, do colaborador e do perfil; quem revisou ou o equipamento sumirem só esvazia o campo", () => {
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u1'; DELETE FROM "equipamentos" WHERE "id" = 'q1'`);
    expect(sql(`SELECT coalesce("revisado_por_id", 'vazio') || '|' || coalesce("equipamento_id", 'vazio') || '|' || "criado_por_id" || '|' || "motivo" FROM "desempenho_penalidades"`)).toBe("vazio|vazio|u2|Defeito do serviço anterior");
    // Perfil apagado: a premiação continua, valendo para todos os perfis
    sql(`DELETE FROM "desempenho_participantes" WHERE "perfil_id" = 'p1'; DELETE FROM "desempenho_perfis" WHERE "id" = 'p1'`);
    expect(sql(`SELECT "titulo" || '|' || coalesce("perfil_id", 'todos') FROM "desempenho_premiacoes"`)).toBe("Kit de ferramentas|todos");
    expect(sql(`SELECT count(*) FROM "desempenho_regras" WHERE "perfil_id" = 'p1'`)).toBe("0"); // as regras do perfil vão junto
    // A OS corretiva apagada leva o item de retorno
    sql(`DELETE FROM "atividades_os" WHERE "ordem_servico_id" = 'os2'; DELETE FROM "ordens_servico" WHERE "id" = 'os2'`);
    expect(sql(`SELECT count(*) FROM "desempenho_penalidades"`)).toBe("0");
    // A empresa apagada leva tudo que é dela — e só dela
    sql(`INSERT INTO "desempenho_participantes" ("id", "empresa_id", "tecnico_id", "perfil_id") VALUES ('pa2', 'e1', 't2', 'p2'), ('pa3', 'e2', 't3', 'pE2')`);
    sql(`DELETE FROM "tecnicos" WHERE "id" = 't2'`);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "desempenho_participantes"`)).toBe("pa3");
    sql(`DELETE FROM "empresas" WHERE "id" = 'e1'`);
    expect(NOVAS.map((t) => `${t}=${sql(`SELECT count(*) FROM "${t}" WHERE "empresa_id" = 'e1'`)}`).join(",")).toBe(NOVAS.map((t) => `${t}=0`).join(","));
    expect(sql(`SELECT (SELECT count(*) FROM "desempenho_config") || '|' || (SELECT count(*) FROM "desempenho_perfis") || '|' || (SELECT count(*) FROM "desempenho_participantes")`)).toBe("1|1|1"); // a empresa e2 intacta
  });

  it("o arquivo só ACRESCENTA: uma coluna, sete tabelas, índices e chaves, cada um com a sua guarda — sem apagar, alterar, preencher ou criar enum", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte).not.toMatch(/CREATE TYPE|ALTER TYPE|DROP |TRUNCATE|DELETE FROM|UPDATE "|ALTER COLUMN|RENAME|INSERT /);
    expect(fonte.match(/ADD COLUMN/g)).toHaveLength(1);
    expect(fonte.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(1);
    expect(fonte.match(/CREATE TABLE/g)).toHaveLength(7);
    expect(fonte.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(7);
    expect(fonte.match(/CREATE (UNIQUE )?INDEX/g)).toHaveLength(15);
    expect(fonte.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g)).toHaveLength(15);
    expect(fonte.match(/ADD CONSTRAINT/g)).toHaveLength(18);
    expect(fonte.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = '[a-z_]+_fkey' AND conrelid = tabela\)/g)).toHaveLength(18);
    // Só mexe (ALTER) na tabela de atividades e nas próprias tabelas novas
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]))].sort()).toEqual(["atividades_os", ...NOVAS].sort());
    expect([...fonte.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(NOVAS);
    expect(fonte).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/m);
  });

  it("dá EXATAMENTE o que o Prisma espera nas sete tabelas e na coluna nova (comparado com `prisma db push`)", () => {
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    // O banco de teste recomeça do zero para a comparação (o teste anterior apagou a empresa e1 em cascata)
    for (const t of NOVAS) {
      expect(colunas(SCHEMA, t), `colunas de ${t}`).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), `índices de ${t}`).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), `chaves de ${t}`).toBe(chaves(PRISMA, t));
    }
    const coluna = (schema: string) => colunas(schema, "atividades_os").split("\n").find((l) => l.startsWith("concluida_em "));
    expect(coluna(SCHEMA)).toBe(coluna(PRISMA));
    expect(coluna(PRISMA)).toBe("concluida_em timestamp without time zone timestamp YES - 3");
  }, 180_000);
});
