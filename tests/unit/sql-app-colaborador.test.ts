/**
 * App do colaborador — o SQL de produção (prisma/sql/2026-11-10_app-colaborador.sql) rodado de verdade
 * num PostgreSQL descartável: adiciona as 11 colunas app* em "configuracoes" e "sessao_ativa" em
 * "usuarios", é idempotente (roda duas vezes) e as empresas já cadastradas herdam os padrões
 * (esconder valores, marca d'água e um dispositivo LIGADOS).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-app-colaborador
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-10_app-colaborador.sql");
const SCHEMA = `teste_app_colab_${process.pid}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const linhas = (q: string) => sql(q).split("\n").filter(Boolean);

const COLS = [
  ["app_exibir_dados_cliente", "true"], ["app_exibir_contatos_cliente", "true"], ["app_esconder_valores", "true"],
  ["app_marca_dagua", "true"], ["app_marca_dagua_os", "true"], ["app_marca_dagua_endereco", "false"],
  ["app_marca_dagua_coordenadas", "false"], ["app_exigir_localizacao", "false"], ["app_foto_somente_camera", "false"],
  ["app_conclusao_obrigatoria", "false"], ["app_um_dispositivo", "true"],
] as const;

describe.skipIf(!URL)("SQL de produção: App do colaborador (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "nome" TEXT);
      INSERT INTO "configuracoes" VALUES ('c1', 'e1');   -- empresa já cadastrada (herda os padrões)
      INSERT INTO "usuarios" VALUES ('u1', 'Ana');
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente, não pode falhar
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("as 11 colunas app* existem como boolean NOT NULL em configuracoes", () => {
    const cols = linhas(`SELECT column_name || ':' || data_type || ':' || is_nullable FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = 'configuracoes' AND column_name LIKE 'app\\_%' ORDER BY column_name`);
    expect(cols).toEqual(COLS.map(([c]) => `${c}:boolean:NO`).sort());
  });

  it("empresa já cadastrada herda os padrões combinados com o produto", () => {
    // boolean || text imprime "true"/"false" (o cast textual do Postgres)
    const valores = sql(`SELECT ${COLS.map(([c]) => `"${c}"`).join(" || '|' || ")} FROM "configuracoes" WHERE "id" = 'c1'`);
    expect(valores).toBe(COLS.map(([, v]) => v).join("|"));
  });

  it("usuarios.sessao_ativa existe (text, nula) e começa vazia", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = 'usuarios' AND column_name = 'sessao_ativa'`)).toBe("text:YES");
    expect(sql(`SELECT coalesce("sessao_ativa", '<nula>') FROM "usuarios" WHERE "id" = 'u1'`)).toBe("<nula>");
  });

  it("rodar de novo não quebra nem muda a empresa existente", () => {
    psql(["-f", ARQUIVO]);
    expect(sql(`SELECT "app_esconder_valores" FROM "configuracoes" WHERE "id" = 'c1'`)).toBe("t");
  });
});
