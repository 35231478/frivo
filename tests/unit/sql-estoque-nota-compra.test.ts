/**
 * Estoque E2 — o SQL de produção (prisma/sql/2026-10-20_estoque_nota_compra.sql) rodado de
 * verdade num PostgreSQL: schema descartável no estado DEPOIS da E1 (com movimentacoes_estoque),
 * roda o arquivo DUAS vezes e confere. Um segundo schema SEM a E1 prova que o arquivo para sem
 * alterar nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-estoque-nota-compra
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-20_estoque_nota_compra.sql");
const SCHEMA = `teste_e2_${process.pid}`;
const SEM_E1 = `teste_e2_sem_e1_${process.pid}`;

function psql(schema: string, args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(SCHEMA, ["-c", q]);
const falha = (q: string) => { try { sql(q); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "fornecedores" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"), "nome" TEXT NOT NULL);
  CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "pedidos_compra_interno" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "contas_pagar" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "numero" TEXT NOT NULL, "valor_total" DECIMAL(12,2) NOT NULL);
  INSERT INTO "empresas" VALUES ('e1'), ('e2');
  INSERT INTO "usuarios" VALUES ('u1');
  INSERT INTO "fornecedores" VALUES ('f1', 'e1', 'Frigelar'), ('f2', 'e2', 'Outro');
  INSERT INTO "produtos" VALUES ('p1', 'e1', 'Gás R410A');
  INSERT INTO "contas_pagar" VALUES ('cp-antiga', 'e1', 'CP-2026-0001', 150.00);
`;

describe.skipIf(!URL)("SQL de produção: nota de compra (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, SEM_E1]) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    // Estado depois da E1: movimentacoes_estoque com custo DECIMAL(12,2) e um lançamento antigo
    sql(BASE + `
      CREATE TABLE "movimentacoes_estoque" ("id" TEXT PRIMARY KEY, "produto_id" TEXT NOT NULL, "quantidade" DECIMAL(12,3) NOT NULL, "custo_unitario" DECIMAL(12,2), "origem" TEXT, "ref_id" TEXT);
      INSERT INTO "movimentacoes_estoque" VALUES ('m-antiga', 'p1', 10, 52.90, 'COMPRA', NULL);
    `);
    psql(SCHEMA, ["-f", ARQUIVO]);
    psql(SCHEMA, ["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${SEM_E1} CASCADE;`]); });

  it("cria o tipo, as 3 tabelas, índices e as 10 chaves — rodando 2x não duplica nem falha", () => {
    expect(sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'StatusNotaCompra' AND n.nspname = '${SCHEMA}'`))
      .toBe("IMPORTADA,CONCILIADA,LANCADA");
    expect(sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}' AND table_name IN ('notas_compra', 'notas_compra_itens', 'de_para_produto_fornecedor')`))
      .toBe("de_para_produto_fornecedor,notas_compra,notas_compra_itens");
    const fks = sql(`SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${SCHEMA}' AND c.contype = 'f' AND c.conname LIKE ANY (ARRAY['notas_compra%', 'de_para%', 'contas_pagar_nota%'])`);
    expect(fks.split(",")).toHaveLength(10);
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname IN ('notas_compra_empresa_id_chave_acesso_key', 'notas_compra_itens_nota_id_numero_item_key', 'de_para_produto_fornecedor_empresa_id_fornecedor_id_codigo__key', 'contas_pagar_nota_compra_id_idx', 'notas_compra_empresa_id_status_criado_em_idx')`)).toBe("5");
    expect(sql(`SELECT column_default FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'notas_compra' AND column_name = 'duplicatas'`)).toBe("'[]'::jsonb");
  });

  it("dados existentes intactos; custo unitário passa a guardar 4 casas", () => {
    expect(sql(`SELECT "id" || '|' || "valor_total" || '|' || COALESCE("nota_compra_id", 'NULL') FROM "contas_pagar"`)).toBe("cp-antiga|150.00|NULL");
    expect(sql(`SELECT "custo_unitario" FROM "movimentacoes_estoque" WHERE "id" = 'm-antiga'`)).toBe("52.9000");
    sql(`INSERT INTO "movimentacoes_estoque" VALUES ('m-nova', 'p1', 1, 0.0345, 'COMPRA', 'n1')`);
    expect(sql(`SELECT "custo_unitario" FROM "movimentacoes_estoque" WHERE "id" = 'm-nova'`)).toBe("0.0345");
    expect(sql(`SELECT numeric_precision || ',' || numeric_scale FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'movimentacoes_estoque' AND column_name = 'custo_unitario'`)).toBe("14,4");
  });

  it("regras do banco: chave única por empresa, itens somem com a nota, conta perde o vínculo, fornecedor com nota não some", () => {
    const nota = (id: string, emp: string, forn: string, chave: string) =>
      `INSERT INTO "notas_compra" ("id", "empresa_id", "fornecedor_id", "chave_acesso", "numero", "serie", "data_emissao", "valor_total", "xml", "emitente_nome", "emitente_cnpj", "atualizado_em")
       VALUES ('${id}', '${emp}', '${forn}', '${chave}', '123', '1', now(), 100, '<xml/>', 'F', '1', now())`;
    const CHAVE = "35261012345678000190550010000001231000001234";
    sql(nota("n1", "e1", "f1", CHAVE));
    expect(falha(nota("n1b", "e1", "f1", CHAVE))).toMatch(/notas_compra_empresa_id_chave_acesso_key/);
    expect(falha(nota("n2", "e2", "f2", CHAVE))).toBeNull(); // mesma chave em OUTRA empresa: permitido
    expect(sql(`SELECT "status" || '|' || "duplicatas"::text FROM "notas_compra" WHERE "id" = 'n1'`)).toBe("IMPORTADA|[]");
    sql(`INSERT INTO "notas_compra_itens" ("id", "nota_id", "numero_item", "codigo_fornecedor", "descricao_fornecedor", "unidade", "quantidade", "valor_unitario", "valor_total", "produto_id")
         VALUES ('i1', 'n1', 1, 'R410-11', 'GAS R410A 11,35KG', 'UN', 2.5, 0.0345, 0.09, 'p1')`);
    expect(falha(`INSERT INTO "notas_compra_itens" ("id", "nota_id", "numero_item", "codigo_fornecedor", "descricao_fornecedor", "unidade", "quantidade", "valor_unitario", "valor_total") VALUES ('i1b', 'n1', 1, 'X', 'X', 'UN', 1, 1, 1)`))
      .toMatch(/notas_compra_itens_nota_id_numero_item_key/);
    sql(`INSERT INTO "de_para_produto_fornecedor" ("id", "empresa_id", "fornecedor_id", "codigo_fornecedor", "descricao_fornecedor", "produto_id", "atualizado_em") VALUES ('d1', 'e1', 'f1', 'R410-11', 'GAS', 'p1', now())`);
    expect(falha(`INSERT INTO "de_para_produto_fornecedor" ("id", "empresa_id", "fornecedor_id", "codigo_fornecedor", "descricao_fornecedor", "produto_id", "atualizado_em") VALUES ('d2', 'e1', 'f1', 'R410-11', 'GAS', 'p1', now())`))
      .toMatch(/de_para_produto_fornecedor_empresa_id_fornecedor_id_codigo__key/);
    expect(falha(`DELETE FROM "fornecedores" WHERE "id" = 'f1'`)).toMatch(/notas_compra_fornecedor_id_fkey/);
    sql(`UPDATE "contas_pagar" SET "nota_compra_id" = 'n1' WHERE "id" = 'cp-antiga'`);
    sql(`DELETE FROM "notas_compra" WHERE "id" = 'n1'`);
    expect(sql(`SELECT count(*) FROM "notas_compra_itens" WHERE "nota_id" = 'n1'`)).toBe("0");
    expect(sql(`SELECT COALESCE("nota_compra_id", 'NULL') FROM "contas_pagar" WHERE "id" = 'cp-antiga'`)).toBe("NULL");
    expect(falha(`INSERT INTO "notas_compra_itens" ("id", "nota_id", "numero_item", "codigo_fornecedor", "descricao_fornecedor", "unidade", "quantidade", "valor_unitario", "valor_total") VALUES ('i9', 'nao-existe', 1, 'X', 'X', 'UN', 1, 1, 1)`))
      .toMatch(/notas_compra_itens_nota_id_fkey/);
  });

  it("sem a E1 no banco: para com a mensagem e não cria nada", () => {
    psql(SEM_E1, ["-c", BASE]);
    let erro = "";
    try { psql(SEM_E1, ["-f", ARQUIVO]); } catch (e) { erro = String((e as { stderr?: string }).stderr); }
    expect(erro).toContain("Rode antes o SQL da Leva E1");
    expect(psql(SEM_E1, ["-c", `SELECT count(*) FROM information_schema.tables WHERE table_schema = '${SEM_E1}' AND table_name LIKE 'notas_compra%'`])).toBe("0");
    expect(psql(SEM_E1, ["-c", `SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SEM_E1}' AND table_name = 'contas_pagar' AND column_name = 'nota_compra_id'`])).toBe("0");
  });
});
