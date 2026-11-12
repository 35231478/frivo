/**
 * Estoque E1 (complemento) — o SQL de produção (prisma/sql/2026-11-06_estoque_e1_complemento.sql)
 * rodado de verdade num PostgreSQL: schema descartável como fica DEPOIS da E1 (o SQL da E1 roda
 * antes), roda o arquivo DUAS vezes e confere: RESERVA no tipo, "controla_estoque" no produto
 * (NOT NULL, padrão true, os existentes com true), nada mais muda; sem a E1, para com erro e não
 * altera nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-estoque-e1-complemento
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const E1 = path.resolve(__dirname, "../../prisma/sql/2026-10-19_estoque_fundacao.sql");
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-06_estoque_e1_complemento.sql");
const SCHEMA = `teste_estoque_compl_${process.pid}`;
const SEM_E1 = `teste_estoque_compl_sem_e1_${process.pid}`;

function psql(schema: string, args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(schema, ["-c", q]);
const falha = (fn: () => void) => { try { fn(); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"));
  CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "estoque_minimo" INTEGER, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "perfis_acesso" ("id" TEXT PRIMARY KEY, "tipo" TEXT NOT NULL, "permissoes" JSONB NOT NULL);
  INSERT INTO "empresas" VALUES ('e1');
  INSERT INTO "usuarios" VALUES ('u1', 'e1');
  INSERT INTO "produtos" ("id", "empresa_id", "nome", "estoque_minimo") VALUES ('p1', 'e1', 'Gás R410A', 5), ('p2', 'e1', 'Filtro', NULL);
`;
const enumTipo = (schema: string) => sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'TipoMovimentacaoEstoque' AND n.nspname = '${schema}'`, schema);

describe.skipIf(!URL)("SQL de produção: estoque E1 — complemento (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, SEM_E1]) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    sql(BASE);
    psql(SCHEMA, ["-f", E1]);
    sql(`INSERT INTO "movimentacoes_estoque" ("id", "empresa_id", "produto_id", "tipo", "origem", "quantidade", "saldo_apos", "usuario_id") VALUES ('m1', 'e1', 'p1', 'ENTRADA', 'COMPRA', 10, 10, 'u1'); UPDATE "produtos" SET "saldo" = 10 WHERE "id" = 'p1';`);
    psql(SCHEMA, ["-f", ARQUIVO]);
    psql(SCHEMA, ["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${SEM_E1} CASCADE;`]); });

  it("RESERVA entra no tipo (uma vez só) e o banco aceita o lançamento com ela; os outros valores ficam na ordem", () => {
    expect(enumTipo(SCHEMA)).toBe("ENTRADA,SAIDA,AJUSTE,DEVOLUCAO,RESERVA");
    expect(sql(`INSERT INTO "movimentacoes_estoque" ("id", "empresa_id", "produto_id", "tipo", "origem", "quantidade", "saldo_apos") VALUES ('m2', 'e1', 'p1', 'RESERVA', 'OS', -2, 8) RETURNING "tipo"`)).toBe("RESERVA");
    expect(falha(() => sql(`INSERT INTO "movimentacoes_estoque" ("id", "empresa_id", "produto_id", "tipo", "origem", "quantidade", "saldo_apos") VALUES ('m3', 'e1', 'p1', 'ROUBO', 'OS', 1, 1)`))).toMatch(/invalid input value for enum/);
  });

  it("produtos.controla_estoque: NOT NULL, padrão true; os existentes ficam com true; o resto (saldo, mínimo, razão) não muda", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable || ':' || column_default FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'produtos' AND column_name = 'controla_estoque'`)).toBe("boolean:NO:true");
    expect(sql(`SELECT string_agg("id" || '|' || "controla_estoque" || '|' || "saldo" || '|' || COALESCE("estoque_minimo"::text, '-'), ',' ORDER BY "id") FROM "produtos"`)).toBe("p1|true|10.000|5,p2|true|0.000|-");
    expect(sql(`INSERT INTO "produtos" ("id", "empresa_id", "nome") VALUES ('p3', 'e1', 'Novo') RETURNING "controla_estoque"`)).toBe("t");
    expect(sql(`UPDATE "produtos" SET "controla_estoque" = false WHERE "id" = 'p2' RETURNING "controla_estoque"`)).toBe("f");
    expect(sql(`SELECT count(*) FROM "movimentacoes_estoque" WHERE "id" = 'm1'`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'movimentacoes_estoque'`)).toBe("3"); // pkey + (empresa, produto, data) + (empresa, data)
  });

  it("sem a E1 no banco: para com a mensagem e não cria nada", () => {
    sql(BASE, SEM_E1);
    const erro = falha(() => psql(SEM_E1, ["-f", ARQUIVO]));
    expect(erro).toContain("Rode antes o SQL da Leva E1");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SEM_E1}' AND table_name = 'produtos' AND column_name = 'controla_estoque'`, SEM_E1)).toBe("0");
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'TipoMovimentacaoEstoque' AND n.nspname = '${SEM_E1}'`, SEM_E1)).toBe("0");
  });
});
