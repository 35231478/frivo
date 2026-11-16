/**
 * O SQL de produção (prisma/sql/2027-01-07_modelos_documento.sql) rodado de verdade num
 * PostgreSQL descartável, POR CIMA de um banco que já está em uso:
 *  - cria só as DUAS tabelas novas — nenhuma tabela existente ganha, perde ou muda coluna;
 *  - os documentos que já estão na ficha continuam iguais, linha por linha;
 *  - as chaves são as certas: empresa e colaborador em CASCADE (o pai manda na existência do
 *    filho), autoria, modelo e anexo em SET NULL — apagar quem criou, o modelo ou o arquivo nunca
 *    apaga o registro de que o documento existiu;
 *  - é idempotente (roda três vezes, com dados gravados, sem erro e sem mudar nada);
 *  - cria as chaves mesmo com HOMÔNIMOS em outro schema (a guarda olha a tabela, não só o nome);
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-modelos-documento
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-07_modelos_documento.sql");
const SCHEMA = `teste_modelos_sql_${process.pid}`;
const PRISMA = `teste_modelos_prisma_${process.pid}`;
/** Schema ISCA: já tem constraints com os MESMOS nomes, em outra tabela. */
const ISCA = `teste_modelos_isca_${process.pid}`;
const NOVAS = ["documento_modelos", "documento_emitidos"];

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

/** Produção hoje: empresa, usuário, colaborador e documentos da ficha JÁ GRAVADOS. */
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
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
  INSERT INTO "tecnicos" VALUES ('t1', 'e1', 'Marina Alves');
  INSERT INTO "colaborador_documentos" ("id", "colaborador_id", "tipo", "nome", "categoria", "origem", "criado_em")
    VALUES ('d1', 't1', 'aso', 'ASO admissional', 'aso', 'MANUAL', '2026-10-02 12:00:00');
`;

/** O que o motor grava depois que as tabelas existem. */
const USO = `
  INSERT INTO "documento_modelos" ("id", "empresa_id", "nome", "tipo", "texto", "tem_itens", "validade_dias", "criado_por_id", "atualizado_em")
    VALUES ('m1', 'e1', 'Ficha de EPI', 'EPI', 'Recebi os equipamentos.', true, 180, 'u1', now());
  INSERT INTO "documento_emitidos" ("id", "empresa_id", "colaborador_id", "modelo_id", "tipo", "titulo", "texto", "itens", "documento_id", "criado_por_id", "atualizado_em")
    VALUES ('x1', 'e1', 't1', 'm1', 'EPI', 'Ficha de EPI', 'Recebi os equipamentos.',
            '[{"descricao":"Luva","ca":"12345","quantidade":2}]'::jsonb, 'd1', 'u1', now());
`;

describe.skipIf(!URL)("SQL dos modelos de documento (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, PRISMA, ISCA]) {
      psql(["-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`], "public");
    }
    psql(["-c", BASE]);
    // A isca: outra tabela, noutro schema, com constraints de MESMO NOME
    psql([
      "-c",
      `CREATE TABLE "documento_modelos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT);
       ALTER TABLE "documento_modelos" ADD CONSTRAINT "documento_modelos_empresa_id_fkey" CHECK ("empresa_id" IS NOT NULL);`,
    ], ISCA);
    // O Prisma, num schema só dele, para comparar
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}` }, stdio: "pipe",
    });
  });

  afterAll(() => {
    for (const s of [SCHEMA, PRISMA, ISCA]) psql(["-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`], "public");
  });

  it("cria as duas tabelas novas e não toca em nenhuma das que já existiam", () => {
    const antes = retrato(["colaborador_documentos", "tecnicos", "usuarios", "empresas"]);
    psql(["-f", ARQUIVO]);
    expect(tabelas()).toEqual(expect.arrayContaining([...NOVAS, "colaborador_documentos", "tecnicos"]));
    expect(retrato(["colaborador_documentos", "tecnicos", "usuarios", "empresas"])).toBe(antes);
  });

  it("as chaves são as certas: CASCADE no dono, SET NULL em autoria, modelo e anexo", () => {
    const fks = chaves(SCHEMA, "documento_emitidos");
    expect(fks).toContain('FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE');
    expect(fks).toContain('FOREIGN KEY (colaborador_id) REFERENCES tecnicos(id) ON UPDATE CASCADE ON DELETE CASCADE');
    expect(fks).toContain('FOREIGN KEY (modelo_id) REFERENCES documento_modelos(id) ON UPDATE CASCADE ON DELETE SET NULL');
    expect(fks).toContain('FOREIGN KEY (documento_id) REFERENCES colaborador_documentos(id) ON UPDATE CASCADE ON DELETE SET NULL');
    expect(fks).toContain('FOREIGN KEY (criado_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL');
    expect(chaves(SCHEMA, "documento_modelos")).toContain('FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE');
  });

  it("apagar o modelo, o usuário ou o anexo NÃO apaga o papel que foi entregue", () => {
    psql(["-c", USO]);
    sql(`DELETE FROM "documento_modelos" WHERE "id" = 'm1'`);
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u1'`);
    sql(`DELETE FROM "colaborador_documentos" WHERE "id" = 'd1'`);
    expect(sql(`SELECT count(*) FROM "documento_emitidos"`)).toBe("1");
    expect(sql(`SELECT coalesce("modelo_id", 'nulo') || ' ' || coalesce("criado_por_id", 'nulo') || ' ' || coalesce("documento_id", 'nulo') FROM "documento_emitidos"`))
      .toBe("nulo nulo nulo");
    // o texto e os itens continuam lá: é o que prova que o papel foi entregue
    expect(sql(`SELECT "itens"->0->>'ca' FROM "documento_emitidos"`)).toBe("12345");
  });

  it("apagar o colaborador leva os documentos dele (o dono manda)", () => {
    sql(`DELETE FROM "tecnicos" WHERE "id" = 't1'`);
    expect(sql(`SELECT count(*) FROM "documento_emitidos"`)).toBe("0");
  });

  it("roda três vezes seguidas, com dados gravados, sem erro e sem mudar nada", () => {
    sql(`INSERT INTO "tecnicos" VALUES ('t1', 'e1', 'Marina Alves')`);
    sql(`INSERT INTO "usuarios" VALUES ('u1', 'e1', 'Ana Souza')`);
    psql(["-c", USO.replace("'d1'", "NULL")]);
    const antes = retrato([...NOVAS, "colaborador_documentos"]);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    expect(retrato([...NOVAS, "colaborador_documentos"])).toBe(antes);
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
    // a isca continua com a dela, intacta, e a nossa existe de verdade
    expect(chaves(ISCA, "documento_modelos")).toContain("CHECK");
    expect(chaves(SCHEMA, "documento_modelos")).toContain("FOREIGN KEY (empresa_id)");
  });
});
