/**
 * Fotos & Anexos do serviço — o SQL de produção (prisma/sql/2026-10-26_os_fotos_anexos.sql) rodado de
 * verdade num PostgreSQL: schema descartável com "os_anexos" como está HOJE (sem as colunas, com
 * anexos), roda o arquivo DUAS vezes e confere: colunas opcionais criadas, anexos antigos intactos
 * (sem equipamento = "Geral da OS"), id do aparelho único, e as chaves estrangeiras soltam a
 * referência (SET NULL) em vez de apagar a foto.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-os-fotos-anexos
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-26_os_fotos_anexos.sql");
const SCHEMA = `teste_os_fotos_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodarArquivo = () => psql(["-f", ARQUIVO]);
const coluna = (nome: string) => sql(`SELECT data_type || ':' || is_nullable FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'os_anexos' AND column_name = '${nome}'`);
const fks = () => sql(`SELECT string_agg(conname || '=' || confdeltype::text, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid = '${SCHEMA}.os_anexos'::regclass AND contype = 'f'`);

describe.skipIf(!URL)("SQL de produção: fotos & anexos da OS (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "os_anexos" (
        "id" TEXT PRIMARY KEY, "ordem_servico_id" TEXT NOT NULL REFERENCES "ordens_servico"("id") ON DELETE CASCADE,
        "nome" TEXT NOT NULL, "tipo" TEXT NOT NULL, "tamanho" INTEGER NOT NULL, "conteudo" TEXT NOT NULL,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO "usuarios" VALUES ('u1');
      INSERT INTO "equipamentos" VALUES ('eq1'), ('eq2');
      INSERT INTO "ordens_servico" VALUES ('os1');
      INSERT INTO "atividades_os" VALUES ('a1');
      INSERT INTO "os_anexos" ("id", "ordem_servico_id", "nome", "tipo", "tamanho", "conteudo") VALUES
        ('an1', 'os1', 'foto-antiga.jpg', 'image/jpeg', 10, 'data:image/jpeg;base64,AAAA'),
        ('an2', 'os1', 'laudo.pdf', 'application/pdf', 20, 'data:application/pdf;base64,AAAA');
    `);
    rodarArquivo();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria as colunas novas, todas opcionais", () => {
    for (const c of ["equipamento_id", "atividade_id", "legenda", "criado_por_id", "client_id"]) expect(coluna(c)).toBe("text:YES");
  });

  it("os anexos antigos ficam como estavam (sem equipamento = Geral da OS; sem legenda; sem autor)", () => {
    expect(sql(`SELECT string_agg("id" || ':' || coalesce("equipamento_id", '-') || ':' || coalesce("legenda", '-') || ':' || coalesce("criado_por_id", '-'), ',' ORDER BY "id") FROM "os_anexos"`))
      .toBe("an1:-:-:-,an2:-:-:-");
  });

  it("chaves estrangeiras com SET NULL: apagar o equipamento/atividade/usuário solta a referência, a foto fica", () => {
    expect(fks()).toBe("os_anexos_atividade_id_fkey=n,os_anexos_criado_por_id_fkey=n,os_anexos_equipamento_id_fkey=n,os_anexos_ordem_servico_id_fkey=c");
    sql(`INSERT INTO "os_anexos" ("id", "ordem_servico_id", "nome", "tipo", "tamanho", "conteudo", "equipamento_id", "atividade_id", "legenda", "criado_por_id", "client_id")
         VALUES ('an3', 'os1', 'f.jpg', 'image/jpeg', 1, 'x', 'eq2', 'a1', 'Placa da condensadora', 'u1', 'aparelho-123')`);
    sql(`DELETE FROM "equipamentos" WHERE "id" = 'eq2'; DELETE FROM "atividades_os" WHERE "id" = 'a1'; DELETE FROM "usuarios" WHERE "id" = 'u1';`);
    expect(sql(`SELECT coalesce("equipamento_id", '-') || ':' || coalesce("atividade_id", '-') || ':' || coalesce("criado_por_id", '-') || ':' || "legenda" FROM "os_anexos" WHERE "id" = 'an3'`))
      .toBe("-:-:-:Placa da condensadora");
  });

  it("o id do aparelho é único (reenviar a mesma foto não duplica)", () => {
    expect(() => sql(`INSERT INTO "os_anexos" ("id", "ordem_servico_id", "nome", "tipo", "tamanho", "conteudo", "client_id") VALUES ('an4', 'os1', 'f.jpg', 'image/jpeg', 1, 'x', 'aparelho-123')`))
      .toThrow(/os_anexos_client_id_key/);
  });

  it("rodar de novo não falha nem muda nada", () => {
    const antes = sql(`SELECT string_agg("id" || ':' || coalesce("legenda", '-'), ',' ORDER BY "id") FROM "os_anexos"`);
    rodarArquivo();
    expect(sql(`SELECT string_agg("id" || ':' || coalesce("legenda", '-'), ',' ORDER BY "id") FROM "os_anexos"`)).toBe(antes);
    expect(fks()).toBe("os_anexos_atividade_id_fkey=n,os_anexos_criado_por_id_fkey=n,os_anexos_equipamento_id_fkey=n,os_anexos_ordem_servico_id_fkey=c");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'os_anexos' AND indexname IN ('os_anexos_client_id_key', 'os_anexos_equipamento_id_idx', 'os_anexos_atividade_id_idx')`)).toBe("3");
  });
});
