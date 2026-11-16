/**
 * O SQL de produção (prisma/sql/2027-01-06_colaborador_documentos.sql) rodado de verdade num
 * PostgreSQL descartável, POR CIMA de uma tabela de documentos JÁ EM USO:
 *  - acrescenta só colunas e um índice em "colaborador_documentos" — nenhuma tabela nova, nenhuma
 *    outra tabela tocada;
 *  - os documentos que já existem continuam iguais, linha por linha: categoria, autoria e rastro
 *    de exclusão nascem VAZIOS, e a origem nasce MANUAL (que é a verdade deles);
 *  - a validade (data_vencimento) NÃO é recriada nem mexida: ela já existia;
 *  - a autoria é SET NULL: apagar o usuário não apaga o documento do colaborador;
 *  - apagar o colaborador continua levando os documentos dele (cascade que já existia);
 *  - é idempotente (roda três vezes, com dados gravados, sem erro e sem mudar nada);
 *  - cria as chaves estrangeiras mesmo com HOMÔNIMOS em outro schema (a guarda olha a tabela, não
 *    só o nome da constraint);
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-colaborador-documentos
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 120_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-06_colaborador_documentos.sql");
const SCHEMA = `teste_docs_sql_${process.pid}`;
const PRISMA = `teste_docs_prisma_${process.pid}`;
/** Schema ISCA: já tem constraints com os MESMOS nomes, em outra tabela. */
const ISCA = `teste_docs_isca_${process.pid}`;
const D = "colaborador_documentos";

/** As colunas que ESTA leva acrescenta */
const NOVAS = ["categoria", "criado_por_id", "excluido_em", "excluido_por_id", "origem", "arquivo_tipo", "tamanho"];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(numeric_precision::text, '-') || ',' || coalesce(numeric_scale::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`).split(",");
const linhas = (tabela: string) => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM "${tabela}" t`);
const retrato = (lista: string[]) => lista.map((t) => `${t}\n${colunas(SCHEMA, t)}\n${indices(SCHEMA, t)}\n${chaves(SCHEMA, t)}\n${linhas(t)}`).join("\n=====\n");

/**
 * Produção hoje: a tabela de documentos como o SQL da admissão a deixou, com papéis JÁ GRAVADOS —
 * inclusive um com data de vencimento (a coluna que já existia) e um que veio pela admissão.
 */
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "tecnicos" (
    "id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL,
    CONSTRAINT "tecnicos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE TABLE "colaborador_documentos" (
    "id" TEXT PRIMARY KEY,
    "colaborador_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "arquivo_url" TEXT,
    "data_vencimento" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "colaborador_documentos_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "tecnicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total'), ('e2', 'Outra');
  INSERT INTO "usuarios" VALUES ('uA', 'e1', 'Ana Souza'), ('uB', 'e2', 'Beto');
  INSERT INTO "tecnicos" VALUES ('t1', 'e1', 'Carlos Oliveira'), ('t2', 'e1', 'Marina Alves');
  INSERT INTO "colaborador_documentos" ("id", "colaborador_id", "tipo", "nome", "arquivo_url", "data_vencimento", "criado_em")
    VALUES ('d1', 't1', 'CNH', 'CNH categoria D', 'data:application/pdf;base64,JVBERg==', '2027-03-10', '2026-01-10 12:00:00'),
           ('d2', 't1', 'Diploma', 'Diploma (papel)', NULL, NULL, '2026-01-11 12:00:00'),
           ('d3', 't2', 'rg', 'RG (frente e verso)', 'data:image/png;base64,iVBORw==', NULL, '2026-02-01 12:00:00');
`;

describe.skipIf(!URL)("SQL de produção: documentos do colaborador (PostgreSQL real)", () => {
  let antes = { tabelas: [] as string[], outras: "", documentos: "" };

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE; DROP SCHEMA IF EXISTS ${ISCA} CASCADE; CREATE SCHEMA ${ISCA};`], { stdio: "pipe" });
    // A isca: os mesmos NOMES de constraint, em outro schema. Um script que confere só o nome
    // (sem a tabela) acharia que as chaves já existem e as pularia caladas.
    sql(`CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "colaborador_documentos" ("id" TEXT PRIMARY KEY, "criado_por_id" TEXT, "excluido_por_id" TEXT,
        CONSTRAINT "colaborador_documentos_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios" ("id"),
        CONSTRAINT "colaborador_documentos_excluido_por_id_fkey" FOREIGN KEY ("excluido_por_id") REFERENCES "usuarios" ("id"));`, ISCA);
    sql(BASE);
    antes = {
      tabelas: tabelas(),
      outras: retrato(tabelas().filter((t) => t !== D)),
      documentos: linhas(D),
    };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE; DROP SCHEMA IF EXISTS ${ISCA} CASCADE;`], { stdio: "pipe" });
  });

  it("não cria tabela nenhuma e não toca em nenhuma outra tabela", () => {
    expect(tabelas()).toEqual(antes.tabelas);
    expect(retrato(antes.tabelas.filter((t) => t !== D))).toBe(antes.outras);
  });

  it("acrescenta EXATAMENTE as colunas desta leva, todas opcionais (menos a origem, com padrão)", () => {
    const linhasCol = colunas(SCHEMA, D).split("\n");
    const achar = (c: string) => linhasCol.find((l) => l.startsWith(`${c} `));
    expect(achar("categoria")).toBe("categoria text text YES - -,-");
    expect(achar("criado_por_id")).toBe("criado_por_id text text YES - -,-");
    expect(achar("excluido_em")).toBe("excluido_em timestamp without time zone timestamp YES - -,-");
    expect(achar("excluido_por_id")).toBe("excluido_por_id text text YES - -,-");
    expect(achar("arquivo_tipo")).toBe("arquivo_tipo text text YES - -,-");
    expect(achar("tamanho")).toBe("tamanho integer int4 YES - 32,0");
    // origem é TEXTO com padrão (sem enum): acrescentar uma origem nova não pede migração de tipo
    expect(achar("origem")).toBe("origem text text NO 'MANUAL'::text -,-");
  });

  it("a validade por documento JÁ EXISTIA: a coluna não é recriada nem mexida", () => {
    expect(colunas(SCHEMA, D).split("\n").find((l) => l.startsWith("data_vencimento ")))
      .toBe("data_vencimento timestamp without time zone timestamp YES - -,-");
    expect(sql(`SELECT "data_vencimento"::date::text FROM "${D}" WHERE "id" = 'd1'`)).toBe("2027-03-10");
  });

  it("os documentos que já existiam continuam EXATAMENTE como estavam, com as colunas novas vazias", () => {
    expect(sql(`SELECT string_agg("id" || '|' || "tipo" || '|' || "nome" || '|' || coalesce("arquivo_url", '-'), ',' ORDER BY "id") FROM "${D}"`))
      .toBe("d1|CNH|CNH categoria D|data:application/pdf;base64,JVBERg==,d2|Diploma|Diploma (papel)|-,d3|rg|RG (frente e verso)|data:image/png;base64,iVBORw==");
    // nada é reclassificado por adivinhação, e ninguém nasce com rastro de exclusão
    expect(sql(`SELECT count(*) FROM "${D}" WHERE "categoria" IS NOT NULL OR "criado_por_id" IS NOT NULL
      OR "excluido_em" IS NOT NULL OR "excluido_por_id" IS NOT NULL OR "arquivo_tipo" IS NOT NULL OR "tamanho" IS NOT NULL`)).toBe("0");
    // a origem dos antigos é MANUAL, que é a verdade deles
    expect(sql(`SELECT string_agg(DISTINCT "origem", ',') FROM "${D}"`)).toBe("MANUAL");
  });

  it("o índice novo é por colaborador e exclusão (é o que a ficha e os filtros pedem)", () => {
    expect(indices(SCHEMA, D)).toContain(`CREATE INDEX colaborador_documentos_colaborador_id_excluido_em_idx ON ${D} USING btree (colaborador_id, excluido_em)`);
  });

  it("as chaves de autoria existem e apontam para usuários — mesmo com HOMÔNIMOS em outro schema", () => {
    // a isca (mesmos nomes, outro schema) continua lá: é ela que prova que a guarda olha a tabela
    expect(chaves(ISCA, D)).toContain("colaborador_documentos_criado_por_id_fkey");
    const fks = chaves(SCHEMA, D);
    expect(fks).toContain("colaborador_documentos_criado_por_id_fkey FOREIGN KEY (criado_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");
    expect(fks).toContain("colaborador_documentos_excluido_por_id_fkey FOREIGN KEY (excluido_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");
    // a chave que já existia continua intacta
    expect(fks).toContain("colaborador_documentos_colaborador_id_fkey FOREIGN KEY (colaborador_id) REFERENCES tecnicos(id) ON UPDATE CASCADE ON DELETE CASCADE");
  });

  it("apagar o USUÁRIO não apaga o documento do colaborador: perde-se o autor, nunca o papel", () => {
    sql(`INSERT INTO "usuarios" VALUES ('uTemp', 'e1', 'Quem sai da empresa')`);
    sql(`UPDATE "${D}" SET "criado_por_id" = 'uTemp', "categoria" = 'cnh' WHERE "id" = 'd1'`);
    sql(`UPDATE "${D}" SET "excluido_por_id" = 'uTemp', "excluido_em" = now() WHERE "id" = 'd2'`);
    sql(`DELETE FROM "usuarios" WHERE "id" = 'uTemp'`);

    expect(sql(`SELECT count(*) FROM "${D}" WHERE "id" IN ('d1', 'd2')`)).toBe("2");
    expect(sql(`SELECT ("criado_por_id" IS NULL)::text || '|' || coalesce("categoria", '-') || '|' || coalesce("arquivo_url", '-') FROM "${D}" WHERE "id" = 'd1'`))
      .toBe("true|cnh|data:application/pdf;base64,JVBERg==");
    // o rastro da exclusão não some junto com o autor: a data fica
    expect(sql(`SELECT ("excluido_por_id" IS NULL)::text || '|' || ("excluido_em" IS NOT NULL)::text FROM "${D}" WHERE "id" = 'd2'`)).toBe("true|true");
  });

  it("apagar o colaborador continua levando os documentos dele (o cascade que já existia)", () => {
    sql(`DELETE FROM "tecnicos" WHERE "id" = 't2'`);
    expect(sql(`SELECT count(*) FROM "${D}" WHERE "colaborador_id" = 't2'`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "${D}"`)).toBe("2");
  });

  it("é idempotente: roda de novo, com dados gravados, sem erro e sem mudar nada", () => {
    const antesDeRodar = retrato(tabelas());
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    expect(retrato(tabelas())).toBe(antesDeRodar);
  });

  it("dá exatamente o que o Prisma espera (comparado com `prisma db push`)", () => {
    execFileSync("psql", [URL!, "-q", "-c", `CREATE SCHEMA ${PRISMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}` }, stdio: "pipe",
    });
    // a tabela inteira tem de bater coluna por coluna com o schema do Prisma
    expect(colunas(SCHEMA, D)).toBe(colunas(PRISMA, D).replaceAll(`${PRISMA}.`, ""));
    expect(colunas(SCHEMA, D).split("\n").filter((l) => NOVAS.some((c) => l.startsWith(`${c} `)))).toHaveLength(NOVAS.length);
    // e o índice também
    expect(indices(SCHEMA, D)).toBe(indices(PRISMA, D).replaceAll(`${PRISMA}.`, ""));
  });
});
