/**
 * Estoque E3.1 — o SQL de produção (prisma/sql/2026-11-07_categoria_produto.sql) rodado de verdade
 * num PostgreSQL: schema descartável com as tabelas como estão HOJE (produto sem categoria), roda o
 * arquivo DUAS vezes e confere: tipo, tabela, FKs, coluna no produto, e o seed das duas categorias
 * do Zé em cada empresa que não tinha nenhuma (quem já tinha não é tocada; rodar de novo não duplica).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-categoria-produto
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-07_categoria_produto.sql");
const SCHEMA = `teste_categoria_produto_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const linhas = (q: string) => sql(q).split("\n").filter(Boolean).map((l) => l.split("|"));
const falha = (q: string) => { try { sql(q); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const rodar = () => psql(["-f", ARQUIVO]);

describe.skipIf(!URL)("SQL de produção: categoria de produto (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
      INSERT INTO "empresas" VALUES ('e1'), ('e2');
      INSERT INTO "produtos" ("id", "empresa_id", "nome") VALUES ('p1', 'e1', 'Gás R410A'), ('p2', 'e1', 'Filtro'), ('pB', 'e2', 'Capacitor');
    `);
    rodar();
    // Entre a 1ª e a 2ª rodada: o Zé da e1 renomeia uma categoria e cria outra; a e2 APAGA as duas do seed e
    // cria a sua (ela já tem categoria: o seed não volta); nasce a e3 (sem nada)
    sql(`
      UPDATE "categorias_produto" SET "nome" = 'Peças' WHERE "id" = 'catp_e1_pecas';
      INSERT INTO "categorias_produto" ("id", "empresa_id", "nome", "comportamento") VALUES ('c-extra', 'e1', 'Consumíveis', 'INCLUSO_NO_SERVICO');
      DELETE FROM "categorias_produto" WHERE "empresa_id" = 'e2';
      INSERT INTO "categorias_produto" ("id", "empresa_id", "nome", "comportamento") VALUES ('c-e2', 'e2', 'Minha própria', 'VENDA_A_PARTE');
      INSERT INTO "empresas" VALUES ('e3');
    `);
    rodar();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria o tipo, a tabela (índice + FK da empresa) e a coluna no produto (índice + FK SET NULL) — rodando 2x não duplica nada", () => {
    expect(sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'ComportamentoFaturamento' AND n.nspname = '${SCHEMA}'`))
      .toBe("VENDA_A_PARTE,INCLUSO_NO_SERVICO");
    const colunas = linhas(`SELECT column_name, is_nullable, COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'categorias_produto' ORDER BY ordinal_position`);
    expect(colunas.map((c) => c[0])).toEqual(["id", "empresa_id", "nome", "comportamento", "ativo", "criado_em", "atualizado_em"]);
    expect(Object.fromEntries(colunas.map((c) => [c[0], c[1]]))).toMatchObject({ nome: "NO", comportamento: "NO", ativo: "NO" });
    expect(sql(`SELECT column_default FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'categorias_produto' AND column_name = 'comportamento'`)).toContain("INCLUSO_NO_SERVICO");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = '${SCHEMA}.categorias_produto'::regclass AND contype = 'f'`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'categorias_produto'`)).toBe("2"); // pkey + (empresa, ativo)
    expect(sql(`SELECT is_nullable FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'produtos' AND column_name = 'categoria_produto_id'`)).toBe("YES");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conname = 'produtos_categoria_produto_id_fkey' AND connamespace = '${SCHEMA}'::regnamespace`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'produtos_categoria_produto_id_idx'`)).toBe("1");
  });

  it("seed por empresa: as duas do Zé em quem não tinha nenhuma; a renomeada/criada da e1 fica como está (sem repor); a e2 que apagou o seed e criou a sua não recebe de novo; a e3 nova recebe na 2ª rodada; nada duplica", () => {
    expect(linhas(`SELECT "empresa_id", "id", "nome", "comportamento"::text, "ativo" FROM "categorias_produto" ORDER BY "empresa_id", "id"`)).toEqual([
      ["e1", "c-extra", "Consumíveis", "INCLUSO_NO_SERVICO", "t"],
      ["e1", "catp_e1_materiais", "Materiais de instalação/consumo", "INCLUSO_NO_SERVICO", "t"],
      ["e1", "catp_e1_pecas", "Peças", "VENDA_A_PARTE", "t"],
      ["e2", "c-e2", "Minha própria", "VENDA_A_PARTE", "t"],
      ["e3", "catp_e3_materiais", "Materiais de instalação/consumo", "INCLUSO_NO_SERVICO", "t"],
      ["e3", "catp_e3_pecas", "Peças de reposição", "VENDA_A_PARTE", "t"],
    ]);
    rodar();
    expect(sql(`SELECT count(*) FROM "categorias_produto"`)).toBe("6");
  });

  it("produtos existentes ficam sem categoria; o vínculo só aceita categoria existente e some (SET NULL) se ela for apagada; tipo fora da lista é recusado", () => {
    expect(sql(`SELECT count(*) FROM "produtos" WHERE "categoria_produto_id" IS NULL`)).toBe("3");
    sql(`UPDATE "produtos" SET "categoria_produto_id" = 'catp_e1_pecas' WHERE "id" = 'p1'`);
    expect(falha(`UPDATE "produtos" SET "categoria_produto_id" = 'nao-existe' WHERE "id" = 'p2'`)).toMatch(/violates foreign key constraint/);
    expect(falha(`INSERT INTO "categorias_produto" ("id", "empresa_id", "nome", "comportamento") VALUES ('x', 'e1', 'X', 'GRATIS')`)).toMatch(/invalid input value for enum/);
    sql(`DELETE FROM "categorias_produto" WHERE "id" = 'catp_e1_pecas'`);
    expect(sql(`SELECT COALESCE("categoria_produto_id", 'NULL') FROM "produtos" WHERE "id" = 'p1'`)).toBe("NULL");
    // A empresa apagada leva as categorias junto (CASCADE)
    sql(`DELETE FROM "empresas" WHERE "id" = 'e3'`);
    expect(sql(`SELECT count(*) FROM "categorias_produto" WHERE "empresa_id" = 'e3'`)).toBe("0");
  });
});
