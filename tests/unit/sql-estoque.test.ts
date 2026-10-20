/**
 * Estoque E1 — o SQL de produção (prisma/sql/2026-10-19_estoque_fundacao.sql) rodado de verdade num
 * PostgreSQL: schema descartável com as tabelas como estão HOJE (produto sem saldo, sem razão),
 * roda o arquivo DUAS vezes e confere o resultado.
 *
 * Precisa de PostgreSQL + psql: roda quando PG_TESTE_URL está definido (o CI sobe um Postgres).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-estoque
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-19_estoque_fundacao.sql");
const SCHEMA = `teste_estoque_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const linhas = (q: string) => sql(q).split("\n").filter(Boolean).map((l) => l.split("|"));
const falha = (q: string) => { try { sql(q); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };

describe.skipIf(!URL)("SQL de produção: estoque (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    // Como está em produção ANTES deste SQL (só as colunas que importam aqui)
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"));
      CREATE TABLE "produtos" (
        "id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE,
        "nome" TEXT NOT NULL, "estoque_minimo" INTEGER, "ativo" BOOLEAN NOT NULL DEFAULT true);
      CREATE TABLE "perfis_acesso" ("id" TEXT PRIMARY KEY, "tipo" TEXT NOT NULL, "permissoes" JSONB NOT NULL);
      INSERT INTO "empresas" VALUES ('e1'), ('e2');
      INSERT INTO "usuarios" VALUES ('u1', 'e1'), ('u2', 'e1');
      INSERT INTO "produtos" ("id", "empresa_id", "nome", "estoque_minimo", "ativo") VALUES
        ('p1', 'e1', 'Gás R410A', 5, true), ('p2', 'e1', 'Filtro', NULL, false), ('pB', 'e2', 'Capacitor', 2, true);
      INSERT INTO "perfis_acesso" VALUES
        ('adm', 'ADMINISTRADOR', '{"ordens": {"visualizar": true}}'),
        ('adm-ja', 'ADMINISTRADOR', '{"estoque": {"visualizar": true, "gerenciar": false}}'),
        ('tec', 'TECNICO', '{"ordens": {"visualizar": true}}'),
        ('pers', 'PERSONALIZADO', '{}'),
        ('ruim', 'ADMINISTRADOR', '[]');
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria os tipos, a tabela, os índices e as 3 chaves — rodando 2x não duplica nada", () => {
    expect(sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'TipoMovimentacaoEstoque' AND n.nspname = '${SCHEMA}'`))
      .toBe("ENTRADA,SAIDA,AJUSTE,DEVOLUCAO");
    expect(sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'OrigemMovimentacaoEstoque' AND n.nspname = '${SCHEMA}'`))
      .toBe("COMPRA,OS,AJUSTE,INVENTARIO");
    const colunas = linhas(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'movimentacoes_estoque' ORDER BY ordinal_position`);
    expect(colunas.map((c) => c[0])).toEqual(["id", "empresa_id", "produto_id", "tipo", "origem", "quantidade", "saldo_apos", "custo_unitario", "ref_id", "observacao", "usuario_id", "local_id", "data", "criado_em"]);
    expect(Object.fromEntries(colunas.map((c) => [c[0], c[2]]))).toMatchObject({ local_id: "YES", ref_id: "YES", custo_unitario: "YES", usuario_id: "YES", quantidade: "NO", saldo_apos: "NO" });
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = '${SCHEMA}.movimentacoes_estoque'::regclass AND contype = 'f'`)).toBe("3");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'movimentacoes_estoque'`)).toBe("3"); // pkey + 2
  });

  it("produtos existentes ficam com saldo 0 (NOT NULL, padrão 0) e nada mais muda", () => {
    expect(linhas(`SELECT "id", "nome", COALESCE("estoque_minimo"::text, '-'), "ativo", "saldo" FROM "produtos" ORDER BY "id"`)).toEqual([
      ["p1", "Gás R410A", "5", "t", "0.000"], ["p2", "Filtro", "-", "f", "0.000"], ["pB", "Capacitor", "2", "t", "0.000"],
    ]);
    expect(sql(`SELECT is_nullable || ':' || column_default FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'produtos' AND column_name = 'saldo'`)).toBe("NO:0");
    expect(sql(`INSERT INTO "produtos" ("id", "empresa_id", "nome") VALUES ('p3', 'e1', 'Novo') RETURNING "saldo"`)).toBe("0.000");
  });

  it("chaves: produto com histórico não pode sumir; usuário apagado vira NULL; razão bate com o saldo", () => {
    sql(`
      INSERT INTO "movimentacoes_estoque" ("id", "empresa_id", "produto_id", "tipo", "origem", "quantidade", "saldo_apos", "usuario_id")
      VALUES ('m1', 'e1', 'p1', 'ENTRADA', 'COMPRA', 10, 10, 'u2'), ('m2', 'e1', 'p1', 'SAIDA', 'OS', -3.5, 6.5, 'u1');
      UPDATE "produtos" SET "saldo" = 6.5 WHERE "id" = 'p1';
    `);
    expect(falha(`DELETE FROM "produtos" WHERE "id" = 'p1'`)).toMatch(/violates foreign key constraint/);
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u2'`);
    expect(sql(`SELECT COALESCE("usuario_id", 'NULL') FROM "movimentacoes_estoque" WHERE "id" = 'm1'`)).toBe("NULL");
    // Tipo fora da lista é recusado pelo banco
    expect(falha(`INSERT INTO "movimentacoes_estoque" ("id", "empresa_id", "produto_id", "tipo", "origem", "quantidade", "saldo_apos") VALUES ('m9', 'e1', 'p1', 'ROUBO', 'OS', 1, 1)`)).toMatch(/invalid input value for enum/);
    // A consulta de conferência do fim do arquivo: nenhum produto com saldo ≠ soma do razão
    expect(sql(`SELECT count(*) FROM (SELECT p."id" FROM "produtos" p LEFT JOIN "movimentacoes_estoque" m ON m."produto_id" = p."id" GROUP BY p."id" HAVING p."saldo" <> COALESCE(SUM(m."quantidade"), 0)) x`)).toBe("0");
  });

  it("permissão “estoque”: só perfis Administrador ganham (uma vez); quem já tinha a chave não é tocado", () => {
    const p = Object.fromEntries(linhas(`SELECT "id", "permissoes"::text FROM "perfis_acesso" ORDER BY "id"`).map(([id, j]) => [id, JSON.parse(j)]));
    expect(p.adm).toEqual({ ordens: { visualizar: true }, estoque: { visualizar: true, gerenciar: true } });
    expect(p["adm-ja"]).toEqual({ estoque: { visualizar: true, gerenciar: false } }); // decisão anterior preservada
    expect(p.tec).toEqual({ ordens: { visualizar: true } });
    expect(p.pers).toEqual({});
    expect(p.ruim).toEqual([]); // JSON que não é objeto: ignorado (não quebra)
  });
});
