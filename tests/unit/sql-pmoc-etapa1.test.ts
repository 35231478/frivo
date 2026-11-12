/**
 * PMOC — Etapa 1: o SQL de produção, em DOIS PASSOS (prisma/sql/2026-10-06_pmoc_etapa1_1_enum.sql e
 * prisma/sql/2026-10-06_pmoc_etapa1_2.sql), rodado de verdade num PostgreSQL descartável: cria UM tipo
 * ("StatusPmoc") e DUAS tabelas ("pmocs", "pmoc_equipamentos"), é idempotente (cada passo roda duas
 * vezes), não mexe em mais nada, e o resultado é EXATAMENTE o que o Prisma espera (comparado com o
 * schema.prisma aplicado por `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-pmoc-etapa1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const PASSO1 = path.join(RAIZ, "prisma/sql/2026-10-06_pmoc_etapa1_1_enum.sql");
const PASSO2 = path.join(RAIZ, "prisma/sql/2026-10-06_pmoc_etapa1_2.sql");
const SCHEMA = `teste_pmoc_sql_${process.pid}`;
const SO_PASSO2 = `teste_pmoc_sql_p2_${process.pid}`;
const JUNTO = `teste_pmoc_sql_junto_${process.pid}`;
const PRISMA = `teste_pmoc_sql_prisma_${process.pid}`;
const TABELAS = ["pmocs", "pmoc_equipamentos"] as const;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** As tabelas que o PMOC referencia, como já existem em produção (só o necessário para as chaves) */
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "clientes" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "unidades" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY, "nome" TEXT);
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total');
  INSERT INTO "clientes" VALUES ('c1', 'Hospital');
  INSERT INTO "unidades" VALUES ('u1', 'Matriz');
  INSERT INTO "tecnicos" VALUES ('t1', 'Eng. Paula');
  INSERT INTO "usuarios" VALUES ('us1', 'Ana');
  INSERT INTO "equipamentos" VALUES ('q1', 'Split 1'), ('q2', 'Split 2');
`;

const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const valoresEnum = (schema: string) => sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${schema}' AND t.typname = 'StatusPmoc'`);
const tabelasDo = (schema: string) => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${schema}'`);
const inserirPmoc = (id: string, extra = "") => sql(`INSERT INTO "pmocs" ("id", "empresa_id", "cliente_id", "unidade_id", "nome", "data_inicio", "data_expiracao", "atualizado_em"${extra ? ', "responsavel_tecnico_id", "criado_por_id"' : ""})
  VALUES ('${id}', 'e1', 'c1', 'u1', 'PMOC ${id}', '2026-01-01', '2026-12-31', now()${extra}) RETURNING "status" || '|' || "ativo"`);

describe.skipIf(!URL)("SQL de produção: PMOC — Etapa 1, em dois passos (PostgreSQL real)", () => {
  beforeAll(() => {
    const novos = [SCHEMA, SO_PASSO2, JUNTO].map((s) => `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`).join(" ");
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `${novos} DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    for (const s of [SCHEMA, SO_PASSO2, JUNTO]) sql(BASE, s);
    psql(["-f", PASSO1]);
    psql(["-f", PASSO1]); // 2ª vez: idempotente, não pode falhar
    psql(["-f", PASSO2]);
    psql(["-f", PASSO2]);
    // O que o Prisma criaria a partir do schema.prisma (a referência)
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  }, 180_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", [SCHEMA, SO_PASSO2, JUNTO, PRISMA].map((s) => `DROP SCHEMA IF EXISTS ${s} CASCADE;`).join(" ")], { stdio: "pipe" }); });

  it("passo 1: o tipo do status tem só RASCUNHO e PUBLICADO (Vigente/Expirado são calculados pela data, não gravados)", () => {
    expect(valoresEnum(SCHEMA)).toBe("RASCUNHO,PUBLICADO");
    expect(valoresEnum(SCHEMA)).toBe(valoresEnum(PRISMA));
  });

  it("passo 2: as duas tabelas são IDÊNTICAS às que o Prisma espera — colunas, tipos, padrões, índices e chaves", () => {
    for (const t of TABELAS) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), t).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), t).toBe(chaves(PRISMA, t));
    }
    expect(colunas(SCHEMA, "pmocs").split("\n")).toHaveLength(21);
    expect(colunas(SCHEMA, "pmoc_equipamentos").split("\n")).toHaveLength(4);
    // 5 chaves estrangeiras + a primária no plano; 2 + a primária nos equipamentos cobertos
    expect(chaves(SCHEMA, "pmocs").split("\n")).toHaveLength(6);
    expect(chaves(SCHEMA, "pmoc_equipamentos").split("\n")).toHaveLength(3);
  });

  it("o plano nasce RASCUNHO e ativo; rodar o SQL de novo não mexe no que já foi gravado", () => {
    expect(inserirPmoc("p1", ", 't1', 'us1'")).toBe("RASCUNHO|true");
    sql(`UPDATE "pmocs" SET "status" = 'PUBLICADO' WHERE "id" = 'p1'`);
    psql(["-f", PASSO1]);
    psql(["-f", PASSO2]);
    expect(sql(`SELECT "status" FROM "pmocs" WHERE "id" = 'p1'`)).toBe("PUBLICADO");
  });

  it("o mesmo equipamento não entra duas vezes no mesmo plano (chave única), mas pode estar em outro plano", () => {
    inserirPmoc("p2");
    const vincular = (id: string, pmoc: string, equip: string) => sql(`INSERT INTO "pmoc_equipamentos" ("id", "pmoc_id", "equipamento_id") VALUES ('${id}', '${pmoc}', '${equip}') ON CONFLICT DO NOTHING RETURNING "id"`);
    expect(vincular("v1", "p1", "q1")).toBe("v1");
    expect(vincular("v2", "p1", "q1")).toBe("");
    expect(vincular("v3", "p1", "q2")).toBe("v3");
    expect(vincular("v4", "p2", "q1")).toBe("v4");
  });

  it("apagar o colaborador ou o usuário não apaga o plano: o vínculo fica vazio (SET NULL)", () => {
    sql(`DELETE FROM "tecnicos" WHERE "id" = 't1'; DELETE FROM "usuarios" WHERE "id" = 'us1';`);
    expect(sql(`SELECT coalesce("responsavel_tecnico_id", 'null') || '|' || coalesce("criado_por_id", 'null') FROM "pmocs" WHERE "id" = 'p1'`)).toBe("null|null");
  });

  it("cliente e unidade com plano não podem ser apagados (RESTRICT); apagar o equipamento só tira o vínculo dele", () => {
    expect(() => sql(`DELETE FROM "clientes" WHERE "id" = 'c1'`)).toThrow(/pmocs_cliente_id_fkey/);
    expect(() => sql(`DELETE FROM "unidades" WHERE "id" = 'u1'`)).toThrow(/pmocs_unidade_id_fkey/);
    sql(`DELETE FROM "equipamentos" WHERE "id" = 'q2'`);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "pmoc_equipamentos"`)).toBe("v1,v4");
    expect(sql(`SELECT count(*) FROM "pmocs"`)).toBe("2");
  });

  it("apagar o plano leva os vínculos dele (CASCADE) — e nenhum equipamento", () => {
    sql(`DELETE FROM "pmocs" WHERE "id" = 'p2'`);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "pmoc_equipamentos"`)).toBe("v1");
    expect(sql(`SELECT count(*) FROM "equipamentos"`)).toBe("1");
  });

  it("rodar só o passo 2 (sem o 1) falha com erro claro e não deixa nada pela metade", () => {
    expect(() => psql(["-f", PASSO2], SO_PASSO2)).toThrow(/StatusPmoc/);
    expect(tabelasDo(SO_PASSO2)).toBe("clientes,empresas,equipamentos,tecnicos,unidades,usuarios");
  });

  it("os dois passos numa transação só também funcionam (o tipo é NOVO: não é o caso de valor novo em enum existente)", () => {
    psql(["-1", "-f", PASSO1, "-f", PASSO2], JUNTO);
    expect(valoresEnum(JUNTO)).toBe("RASCUNHO,PUBLICADO");
    for (const t of TABELAS) expect(colunas(JUNTO, t), t).toBe(colunas(PRISMA, t));
  });

  it("é só aditivo: um tipo e duas tabelas novas; nenhuma tabela existente é alterada; sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const semComentarios = (arq: string) => fs.readFileSync(arq, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const p1 = semComentarios(PASSO1), p2 = semComentarios(PASSO2);
    expect(p1.match(/CREATE TYPE/g)).toHaveLength(1);
    expect(p1).toMatch(/IF NOT EXISTS[\s\S]*CREATE TYPE "StatusPmoc" AS ENUM \('RASCUNHO', 'PUBLICADO'\)/);
    expect(p1).not.toMatch(/\b(TABLE|INDEX|ADD VALUE)\b/);
    expect(p2).not.toMatch(/CREATE TYPE|ALTER TYPE/);
    expect([...p2.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z_]+)"/g)].map((m) => m[1])).toEqual(["pmocs", "pmoc_equipamentos"]);
    expect(p2.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(p2.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g)).toHaveLength(5);
    expect(p2.match(/CREATE (?:UNIQUE )?INDEX/g)).toHaveLength(5);
    expect(p2).not.toMatch(/ADD COLUMN/);
    expect(p2).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    // As únicas tabelas alteradas são as duas novas (para receber as chaves estrangeiras)
    expect([...new Set([...p2.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]))].sort()).toEqual(["pmoc_equipamentos", "pmocs"]);
    for (const fonte of [p1, p2]) expect(fonte.replace(/ON DELETE (CASCADE|RESTRICT|SET NULL) ON UPDATE CASCADE/g, "")).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
  });

  it("o schema do Prisma aponta para as mesmas tabelas e o mesmo tipo; nada de coluna nova em tabela existente", () => {
    const schema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/enum StatusPmoc \{\s+RASCUNHO\s+PUBLICADO\s+\}/);
    expect(schema).toMatch(/model Pmoc \{[\s\S]*?status\s+StatusPmoc\s+@default\(RASCUNHO\)[\s\S]*?@@map\("pmocs"\)/);
    expect(schema).toMatch(/model PmocEquipamento \{[\s\S]*?@@unique\(\[pmocId, equipamentoId\]\)[\s\S]*?@@map\("pmoc_equipamentos"\)/);
    // Do lado das tabelas existentes só há a relação inversa (lista), que não vira coluna
    const inversas = [...schema.matchAll(/^\s+(pmocs\w*)\s+(Pmoc(?:Equipamento)?)\[\](?:\s+@relation\("\w+"\))?$/gm)].map((m) => m[1]);
    expect(inversas.sort()).toEqual(["pmocs", "pmocs", "pmocs", "pmocs", "pmocsCriados", "pmocsResponsavel"]);
  });
});
