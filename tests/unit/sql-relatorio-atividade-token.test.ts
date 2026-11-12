/**
 * Segurança — o SQL de produção (prisma/sql/2026-10-20_relatorio_atividade_token.sql) rodado de
 * verdade num PostgreSQL: schema descartável com "atividades_os" como está HOJE (sem a coluna e com
 * 300 atividades), roda o arquivo DUAS vezes e confere o backfill, o padrão e o índice único.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-relatorio-atividade-token
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-20_relatorio_atividade_token.sql");
const SCHEMA = `teste_reltok_${process.pid}`;
const FORMATO = "^[A-Za-z0-9_-]{43}$";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);
const rodarArquivo = (schema = SCHEMA) => psql(["-f", ARQUIVO], schema);
const recriar = (schema: string) =>
  execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`]);
/** Todos os tokens, na ordem do id (para comparar antes × depois). */
const tokens = () => sql(`SELECT string_agg("id" || '=' || "token_relatorio", ',' ORDER BY "id") FROM "atividades_os"`);

describe.skipIf(!URL)("SQL de produção: token do relatório de atividade (PostgreSQL real)", () => {
  let depoisDaPrimeira = "";

  beforeAll(() => {
    recriar(SCHEMA);
    sql(`
      CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "titulo" TEXT NOT NULL);
      INSERT INTO "atividades_os" SELECT 'at' || lpad(n::text, 3, '0'), 'e' || (n % 3), 'Atividade ' || n FROM generate_series(1, 300) n;
    `);
    rodarArquivo();
    depoisDaPrimeira = tokens();
    rodarArquivo(); // 2ª vez: não pode falhar nem trocar nada
  });
  afterAll(() => {
    for (const s of [SCHEMA, `${SCHEMA}_parcial`]) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`]);
  });

  it("backfill: TODAS as atividades que já existiam ganham token — 43 caracteres base64url, 32 bytes, nenhum repetido", () => {
    expect(sql(`SELECT count(*) FROM "atividades_os"`)).toBe("300");
    expect(sql(`SELECT count(*) FROM "atividades_os" WHERE "token_relatorio" IS NULL`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "atividades_os" WHERE "token_relatorio" !~ '${FORMATO}'`)).toBe("0");
    expect(sql(`SELECT count(DISTINCT "token_relatorio") FROM "atividades_os"`)).toBe("300");
    // base64url → bytes: são 32 bytes cada
    expect(sql(`SELECT DISTINCT length(decode(translate("token_relatorio", '-_', '+/') || '=', 'base64')) FROM "atividades_os"`)).toBe("32");
    // o resto da linha fica igual
    expect(sql(`SELECT count(*) FROM "atividades_os" WHERE "titulo" = 'Atividade ' || ltrim(substr("id", 3), '0')`)).toBe("300");
  });

  it("rodar de novo NÃO troca token de ninguém (links já enviados continuam valendo)", () => {
    expect(depoisDaPrimeira).not.toBe("");
    expect(tokens()).toBe(depoisDaPrimeira);
  });

  it("coluna TEXT NOT NULL com padrão gerado pelo banco e índice único com o nome do Prisma", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable || ':' || (column_default IS NOT NULL) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'atividades_os' AND column_name = 'token_relatorio'`))
      .toBe("text:NO:true");
    expect(sql(`SELECT indexdef FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'atividades_os' AND indexname = 'atividades_os_token_relatorio_key'`))
      .toBe(`CREATE UNIQUE INDEX atividades_os_token_relatorio_key ON ${SCHEMA}.atividades_os USING btree (token_relatorio)`);
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'atividades_os'`)).toBe("2"); // pkey + token (2ª vez não duplicou)
  });

  it("atividade nova já nasce com token próprio (o app não precisa mandar); repetido ou vazio o banco recusa", () => {
    sql(`INSERT INTO "atividades_os" ("id", "empresa_id", "titulo") VALUES ('nova1', 'e1', 'Nova'), ('nova2', 'e1', 'Nova 2')`);
    const [t1, t2] = sql(`SELECT "token_relatorio" FROM "atividades_os" WHERE "id" IN ('nova1', 'nova2') ORDER BY "id"`).split("\n");
    expect(t1).toMatch(new RegExp(FORMATO));
    expect(t2).toMatch(new RegExp(FORMATO));
    expect(t1).not.toBe(t2);
    expect(sql(`SELECT count(*) FROM "atividades_os" WHERE "token_relatorio" = '${t1}'`)).toBe("1");
    expect(() => sql(`INSERT INTO "atividades_os" VALUES ('nova3', 'e1', 'Copia', '${t1}')`)).toThrow(/atividades_os_token_relatorio_key/);
    expect(() => sql(`INSERT INTO "atividades_os" VALUES ('nova4', 'e1', 'Sem token', NULL)`)).toThrow(/null value in column "token_relatorio"/);
  });

  it("banco onde a coluna já existia pela metade (alguns com token): mantém os que têm e completa só os vazios", () => {
    const s = `${SCHEMA}_parcial`;
    recriar(s);
    sql(`
      CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "titulo" TEXT NOT NULL, "token_relatorio" TEXT);
      INSERT INTO "atividades_os" VALUES ('a1', 'e1', 'A', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), ('a2', 'e1', 'B', NULL), ('a3', 'e2', 'C', NULL);
    `, s);
    rodarArquivo(s);
    expect(sql(`SELECT "token_relatorio" FROM "atividades_os" WHERE "id" = 'a1'`, s)).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(sql(`SELECT count(*) FROM "atividades_os" WHERE "token_relatorio" ~ '${FORMATO}'`, s)).toBe("3");
    expect(sql(`SELECT count(DISTINCT "token_relatorio") FROM "atividades_os"`, s)).toBe("3");
  });
});
