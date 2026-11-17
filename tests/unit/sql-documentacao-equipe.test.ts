/**
 * O SQL de produção (prisma/sql/2027-01-08_documentacao_equipe.sql) rodado de verdade num
 * PostgreSQL descartável, POR CIMA de um banco que já está em uso:
 *  - cria só as TRÊS tabelas novas — nenhuma tabela existente ganha, perde ou muda coluna;
 *  - os documentos que já estão na ficha continuam iguais, linha por linha;
 *  - as chaves são as certas: a empresa manda no envio e o envio manda nos itens e nos eventos
 *    (CASCADE); cliente, contrato, autoria, colaborador e arquivo em SET NULL — apagar qualquer um
 *    deles nunca apaga o registro de que aquele pacote foi enviado àquele cliente;
 *  - o token do link é único;
 *  - é idempotente (roda três vezes, com dados gravados, sem erro e sem mudar nada);
 *  - cria as chaves mesmo com HOMÔNIMOS em outro schema (a guarda olha a tabela, não só o nome);
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-documentacao-equipe
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-08_documentacao_equipe.sql");
const SCHEMA = `teste_docequipe_sql_${process.pid}`;
const PRISMA = `teste_docequipe_prisma_${process.pid}`;
/** Schema ISCA: já tem constraints com os MESMOS nomes, em outra tabela. */
const ISCA = `teste_docequipe_isca_${process.pid}`;
const NOVAS = ["documentacao_envios", "documentacao_envio_itens", "documentacao_envio_eventos"];
const ANTIGAS = ["colaborador_documentos", "tecnicos", "usuarios", "clientes", "contratos", "empresas"];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const tabelas = (schema = SCHEMA) => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${schema}'`).split(",");
const linhas = (tabela: string) => sql(`SELECT coalesce(string_agg(t::text, ';' ORDER BY t::text), '') FROM "${tabela}" t`);
const retrato = (lista: string[]) => lista.map((t) => `${t}\n${colunas(SCHEMA, t)}\n${indices(SCHEMA, t)}\n${chaves(SCHEMA, t)}\n${linhas(t)}`).join("\n=====\n");

/** Produção hoje: empresa, usuário, cliente, contrato, colaborador e documentos JÁ GRAVADOS. */
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "clientes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "contratos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "cliente_id" TEXT NOT NULL, "numero" TEXT NOT NULL);
  CREATE TABLE "tecnicos" (
    "id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL,
    CONSTRAINT "tecnicos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE TABLE "colaborador_documentos" (
    "id" TEXT PRIMARY KEY, "colaborador_id" TEXT NOT NULL, "tipo" TEXT NOT NULL, "nome" TEXT NOT NULL,
    "categoria" TEXT, "origem" TEXT NOT NULL DEFAULT 'MANUAL', "data_vencimento" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "colaborador_documentos_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "tecnicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total');
  INSERT INTO "usuarios" VALUES ('u1', 'e1', 'Ana Souza');
  INSERT INTO "clientes" VALUES ('c1', 'e1', 'Shopping Ibirapuera');
  INSERT INTO "contratos" VALUES ('k1', 'e1', 'c1', 'CT-0001');
  INSERT INTO "tecnicos" VALUES ('t1', 'e1', 'Marina Alves');
  INSERT INTO "colaborador_documentos" ("id", "colaborador_id", "tipo", "nome", "categoria", "origem", "data_vencimento", "criado_em")
    VALUES ('d1', 't1', 'aso', 'ASO periódico', 'aso', 'MANUAL', '2027-10-02 00:00:00', '2026-10-02 12:00:00');
`;

/** O que o motor grava depois que as tabelas existem. */
const USO = `
  INSERT INTO "documentacao_envios" ("id", "empresa_id", "cliente_id", "cliente_nome", "contrato_id", "categorias", "token", "expira_em", "criado_por_id", "atualizado_em")
    VALUES ('v1', 'e1', 'c1', 'Shopping Ibirapuera', 'k1', ARRAY['aso','nr_10'], 'tok-1', now() + interval '7 days', 'u1', now());
  INSERT INTO "documentacao_envio_itens" ("id", "envio_id", "documento_id", "colaborador_id", "colaborador_nome", "categoria", "nome", "caminho", "data_vencimento")
    VALUES ('i1', 'v1', 'd1', 't1', 'Marina Alves', 'aso', 'ASO periódico', 'Marina Alves/ASO (exame) - ASO periódico', '2027-10-02 00:00:00');
  INSERT INTO "documentacao_envio_eventos" ("id", "envio_id", "tipo", "usuario_id", "detalhe")
    VALUES ('ev1', 'v1', 'CRIADO', 'u1', '{"via":"LINK"}'::jsonb), ('ev2', 'v1', 'ACESSO', NULL, NULL);
`;

describe.skipIf(!URL)("SQL da documentação da equipe (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, PRISMA, ISCA]) {
      psql(["-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`], "public");
    }
    psql(["-c", BASE]);
    // A isca: outra tabela, noutro schema, com constraint de MESMO NOME
    psql([
      "-c",
      `CREATE TABLE "documentacao_envios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT);
       ALTER TABLE "documentacao_envios" ADD CONSTRAINT "documentacao_envios_empresa_id_fkey" CHECK ("empresa_id" IS NOT NULL);`,
    ], ISCA);
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}` }, stdio: "pipe",
    });
  });

  afterAll(() => {
    for (const s of [SCHEMA, PRISMA, ISCA]) psql(["-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`], "public");
  });

  it("cria as três tabelas novas e não toca em nenhuma das que já existiam", () => {
    const antes = retrato(ANTIGAS);
    psql(["-f", ARQUIVO]);
    expect(tabelas()).toEqual(expect.arrayContaining([...NOVAS, ...ANTIGAS]));
    expect(retrato(ANTIGAS)).toBe(antes);
  });

  it("as chaves são as certas: CASCADE no dono, SET NULL em tudo o que é referência", () => {
    const envio = chaves(SCHEMA, "documentacao_envios");
    expect(envio).toContain("FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(envio).toContain("FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON UPDATE CASCADE ON DELETE SET NULL");
    expect(envio).toContain("FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON UPDATE CASCADE ON DELETE SET NULL");
    expect(envio).toContain("FOREIGN KEY (criado_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");
    expect(envio).toContain("FOREIGN KEY (revogado_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");

    const itens = chaves(SCHEMA, "documentacao_envio_itens");
    expect(itens).toContain("FOREIGN KEY (envio_id) REFERENCES documentacao_envios(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(itens).toContain("FOREIGN KEY (documento_id) REFERENCES colaborador_documentos(id) ON UPDATE CASCADE ON DELETE SET NULL");
    expect(itens).toContain("FOREIGN KEY (colaborador_id) REFERENCES tecnicos(id) ON UPDATE CASCADE ON DELETE SET NULL");

    const eventos = chaves(SCHEMA, "documentacao_envio_eventos");
    expect(eventos).toContain("FOREIGN KEY (envio_id) REFERENCES documentacao_envios(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(eventos).toContain("FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");
  });

  it("dois envios não dividem o mesmo token", () => {
    psql(["-c", USO]);
    expect(() => sql(`INSERT INTO "documentacao_envios" ("id", "empresa_id", "cliente_nome", "token", "atualizado_em") VALUES ('v2', 'e1', 'Outro', 'tok-1', now())`))
      .toThrow(/documentacao_envios_token_key|duplicate/i);
    // sem link (só zip) pode haver quantos quiser: NULL não colide
    sql(`INSERT INTO "documentacao_envios" ("id", "empresa_id", "cliente_nome", "atualizado_em") VALUES ('v3', 'e1', 'A', now()), ('v4', 'e1', 'B', now())`);
    sql(`DELETE FROM "documentacao_envios" WHERE "id" IN ('v3', 'v4')`);
  });

  it("apagar o cliente, o contrato, o usuário ou o arquivo NÃO apaga o registro do envio", () => {
    sql(`DELETE FROM "contratos" WHERE "id" = 'k1'`);
    sql(`DELETE FROM "clientes" WHERE "id" = 'c1'`);
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u1'`);
    sql(`DELETE FROM "colaborador_documentos" WHERE "id" = 'd1'`);

    expect(sql(`SELECT coalesce("cliente_id", 'nulo') || ' ' || coalesce("contrato_id", 'nulo') || ' ' || coalesce("criado_por_id", 'nulo') || ' ' || "cliente_nome" FROM "documentacao_envios"`))
      .toBe("nulo nulo nulo Shopping Ibirapuera");
    // o item continua dizendo o que foi enviado e de quem
    expect(sql(`SELECT coalesce("documento_id", 'nulo') || ' ' || "colaborador_nome" || ' ' || "categoria" FROM "documentacao_envio_itens"`))
      .toBe("nulo Marina Alves aso");
    expect(sql(`SELECT count(*) FROM "documentacao_envio_eventos"`)).toBe("2");
  });

  it("apagar o colaborador também não apaga o rastro (só solta o vínculo)", () => {
    sql(`DELETE FROM "tecnicos" WHERE "id" = 't1'`);
    expect(sql(`SELECT coalesce("colaborador_id", 'nulo') || ' ' || "colaborador_nome" FROM "documentacao_envio_itens"`)).toBe("nulo Marina Alves");
  });

  it("apagar o envio leva os itens e os eventos dele", () => {
    sql(`DELETE FROM "documentacao_envios" WHERE "id" = 'v1'`);
    expect(sql(`SELECT (SELECT count(*) FROM "documentacao_envio_itens") + (SELECT count(*) FROM "documentacao_envio_eventos")`)).toBe("0");
  });

  it("roda três vezes seguidas, com dados gravados, sem erro e sem mudar nada", () => {
    sql(`INSERT INTO "usuarios" VALUES ('u1', 'e1', 'Ana Souza')`);
    sql(`INSERT INTO "clientes" VALUES ('c1', 'e1', 'Shopping Ibirapuera')`);
    sql(`INSERT INTO "contratos" VALUES ('k1', 'e1', 'c1', 'CT-0001')`);
    sql(`INSERT INTO "tecnicos" VALUES ('t1', 'e1', 'Marina Alves')`);
    sql(`INSERT INTO "colaborador_documentos" ("id", "colaborador_id", "tipo", "nome", "categoria") VALUES ('d1', 't1', 'aso', 'ASO periódico', 'aso')`);
    psql(["-c", USO.replace(/now\(\) \+ interval '7 days'/, "'2027-01-15 12:00:00'").replaceAll("now()", "'2027-01-08 12:00:00'")]);
    const antes = retrato([...NOVAS, ...ANTIGAS]);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    expect(retrato([...NOVAS, ...ANTIGAS])).toBe(antes);
  });

  it("dá exatamente o que o Prisma espera", () => {
    for (const t of NOVAS) {
      expect(colunas(SCHEMA, t), `colunas de ${t}`).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t).replaceAll(SCHEMA, "S").replaceAll(PRISMA, "S"), `índices de ${t}`)
        .toBe(indices(PRISMA, t).replaceAll(PRISMA, "S").replaceAll(SCHEMA, "S"));
      expect(chaves(SCHEMA, t), `chaves de ${t}`).toBe(chaves(PRISMA, t));
    }
  });

  it("o homônimo em outro schema não faz o script pular a chave estrangeira", () => {
    expect(chaves(ISCA, "documentacao_envios")).toContain("CHECK");
    expect(chaves(SCHEMA, "documentacao_envios")).toContain("FOREIGN KEY (empresa_id)");
  });
});
