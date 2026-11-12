/**
 * Estoque E2.1 — o SQL de produção (prisma/sql/2026-10-20_estoque_nota_compra_financeiro.sql) rodado de
 * verdade num PostgreSQL: schema descartável no estado DEPOIS da E2 (o SQL da E2 rodado de verdade por
 * cima de uma base mínima), roda o arquivo DUAS vezes e confere tabela, colunas, índices e chaves (nomes
 * do Prisma, ON DELETE SET NULL). Outros dois schemas provam que, sem a E2 (ou só com a 1ª versão dela,
 * sem o ajuste), o arquivo para com erro e não altera nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-estoque-nota-compra-financeiro
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-20_estoque_nota_compra_financeiro.sql");
const ARQUIVO_E2 = path.resolve(__dirname, "../../prisma/sql/2026-10-20_estoque_nota_compra.sql");
const ARQUIVO_E2_V1 = path.resolve(__dirname, "fixtures/sql/estoque_nota_compra-v1.sql");
const SCHEMA = `teste_e21_${process.pid}`;
const SEM_E2 = `teste_e21_sem_e2_${process.pid}`;
const SO_V1 = `teste_e21_v1_${process.pid}`;

function psql(schema: string, args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(schema, ["-c", q]);
const erroDe = (schema: string, arquivo: string) => { try { psql(schema, ["-f", arquivo]); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
/** Estado antes da E2: o que a E2 e a E2.1 referenciam (empresas, fornecedores, produtos, contas, categorias, o tipo da forma) */
const BASE = `
  CREATE TYPE "FormaPagamento" AS ENUM ('BOLETO', 'PIX', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO', 'CHEQUE');
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "fornecedores" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"), "nome" TEXT NOT NULL);
  CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "pedidos_compra_interno" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "categorias_financeiras" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "contas_pagar" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "numero" TEXT NOT NULL, "valor_total" DECIMAL(12,2) NOT NULL,
    "forma_pagamento" "FormaPagamento", "categoria_id" TEXT);
  CREATE TABLE "movimentacoes_estoque" ("id" TEXT PRIMARY KEY, "produto_id" TEXT NOT NULL, "quantidade" DECIMAL(12,3) NOT NULL, "custo_unitario" DECIMAL(12,2), "origem" TEXT, "ref_id" TEXT);
  INSERT INTO "empresas" VALUES ('e1'), ('e2');
  INSERT INTO "fornecedores" VALUES ('f1', 'e1', 'Frigelar');
  INSERT INTO "produtos" VALUES ('p1', 'e1', 'Gás R410A');
  INSERT INTO "categorias_financeiras" VALUES ('cat1', 'e1', 'Materiais');
  INSERT INTO "contas_pagar" VALUES ('cp-antiga', 'e1', 'CP-2026-0001', 150.00, 'PIX', 'cat1');
`;
const schemas = [SCHEMA, SEM_E2, SO_V1];

describe.skipIf(!URL)("SQL de produção: E2.1 — central de lançamento (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of schemas) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    sql(BASE);
    psql(SCHEMA, ["-f", ARQUIVO_E2]); // a E2 (com o ajuste), rodada de verdade
    sql(`INSERT INTO "notas_compra" ("id", "empresa_id", "fornecedor_id", "chave_acesso", "numero", "serie", "data_emissao", "valor_total", "xml", "emitente_nome", "emitente_cnpj", "atualizado_em")
         VALUES ('n1', 'e1', 'f1', '35261011222333000181550010000045211000045217', '4521', '1', now(), 1749.30, '<xml/>', 'F', '1', now());
         INSERT INTO "notas_compra_itens" ("id", "nota_id", "numero_item", "codigo_fornecedor", "descricao_fornecedor", "unidade", "quantidade", "valor_unitario", "valor_total", "produto_id")
         VALUES ('i1', 'n1', 1, 'R410A-11', 'GAS', 'UN', 2, 689.9, 1379.8, 'p1');`);
    psql(SCHEMA, ["-f", ARQUIVO]);
    psql(SCHEMA, ["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", schemas.map((s) => `DROP SCHEMA IF EXISTS ${s} CASCADE;`).join(" ")]); });

  const colunas = (tabela: string, nomes: string[], schema = SCHEMA) => psql(schema, ["-c",
    `SELECT string_agg(column_name || ':' || CASE WHEN data_type = 'USER-DEFINED' THEN udt_name ELSE data_type END || COALESCE('(' || numeric_precision || ',' || numeric_scale || ')', '') || ':' || is_nullable || ':' || COALESCE(column_default, '-'), ' ' ORDER BY column_name)
     FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' AND column_name IN (${nomes.map((n) => `'${n}'`).join(", ")})`]);

  it("cria centros_custo e as colunas novas, com os tipos certos — rodando 2x não duplica nem falha", () => {
    expect(colunas("centros_custo", ["id", "empresa_id", "nome", "ativo", "criado_em", "atualizado_em"])).toBe(
      "ativo:boolean:NO:true atualizado_em:timestamp without time zone:NO:- criado_em:timestamp without time zone:NO:CURRENT_TIMESTAMP empresa_id:text:NO:- id:text:NO:- nome:text:NO:-");
    expect(colunas("contas_pagar", ["centro_custo_id", "linha_digitavel", "codigo_barras_boleto", "forma_pagamento"]))
      .toBe("centro_custo_id:text:YES:- codigo_barras_boleto:text:YES:- forma_pagamento:FormaPagamento:YES:- linha_digitavel:text:YES:-");
    expect(colunas("fornecedores", ["categoria_padrao_id", "centro_custo_padrao_id"])).toBe("categoria_padrao_id:text:YES:- centro_custo_padrao_id:text:YES:-");
    expect(colunas("notas_compra", ["categoria_id", "centro_custo_id", "forma_pagamento", "parcelas"]))
      .toBe("categoria_id:text:YES:- centro_custo_id:text:YES:- forma_pagamento:FormaPagamento:YES:- parcelas:jsonb:YES:-");
    expect(colunas("notas_compra_itens", ["preco_venda", "margem_venda"])).toBe("margem_venda:numeric(5,2):YES:- preco_venda:numeric(12,2):YES:-");
  });

  it("índices e as 6 chaves com os nomes do Prisma; toda FK nova é ON DELETE SET NULL (menos a da empresa)", () => {
    expect(sql(`SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname IN (
      'centros_custo_empresa_id_ativo_idx', 'contas_pagar_centro_custo_id_idx', 'fornecedores_categoria_padrao_id_idx', 'fornecedores_centro_custo_padrao_id_idx',
      'notas_compra_categoria_id_idx', 'notas_compra_centro_custo_id_idx')`)).toBe(
      "centros_custo_empresa_id_ativo_idx,contas_pagar_centro_custo_id_idx,fornecedores_categoria_padrao_id_idx,fornecedores_centro_custo_padrao_id_idx,notas_compra_categoria_id_idx,notas_compra_centro_custo_id_idx");
    const fks = sql(`SELECT string_agg(c.conname || ':' || c.confdeltype::text, ',' ORDER BY c.conname) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = '${SCHEMA}' AND c.contype = 'f' AND c.conname IN ('centros_custo_empresa_id_fkey', 'contas_pagar_centro_custo_id_fkey',
      'fornecedores_categoria_padrao_id_fkey', 'fornecedores_centro_custo_padrao_id_fkey', 'notas_compra_categoria_id_fkey', 'notas_compra_centro_custo_id_fkey')`);
    // c = CASCADE, n = SET NULL
    expect(fks).toBe("centros_custo_empresa_id_fkey:c,contas_pagar_centro_custo_id_fkey:n,fornecedores_categoria_padrao_id_fkey:n,fornecedores_centro_custo_padrao_id_fkey:n,notas_compra_categoria_id_fkey:n,notas_compra_centro_custo_id_fkey:n");
  });

  it("dados existentes intactos: conta antiga (forma e categoria), nota e item da E2 seguem iguais, com o novo vazio", () => {
    expect(sql(`SELECT "id" || '|' || "valor_total" || '|' || "forma_pagamento" || '|' || "categoria_id" || '|' || COALESCE("centro_custo_id", 'NULL') || '|' || COALESCE("linha_digitavel", 'NULL') FROM "contas_pagar"`))
      .toBe("cp-antiga|150.00|PIX|cat1|NULL|NULL");
    expect(sql(`SELECT "status" || '|' || COALESCE("categoria_id", 'NULL') || '|' || COALESCE("parcelas"::text, 'NULL') || '|' || "duplicatas"::text FROM "notas_compra"`)).toBe("IMPORTADA|NULL|NULL|[]");
    expect(sql(`SELECT "fator_conversao" || '|' || COALESCE("preco_venda"::text, 'NULL') FROM "notas_compra_itens"`)).toBe("1.000000|NULL");
  });

  it("regras do banco: centro ou categoria apagados → conta, fornecedor e nota ficam sem (SET NULL), nada some; centro sem empresa não entra", () => {
    sql(`INSERT INTO "centros_custo" ("id", "empresa_id", "nome", "atualizado_em") VALUES ('cc1', 'e1', 'Obra', now());
         UPDATE "contas_pagar" SET "centro_custo_id" = 'cc1', "linha_digitavel" = '10492006506100010004200997263900989810000021403';
         UPDATE "fornecedores" SET "centro_custo_padrao_id" = 'cc1', "categoria_padrao_id" = 'cat1';
         UPDATE "notas_compra" SET "centro_custo_id" = 'cc1', "categoria_id" = 'cat1', "forma_pagamento" = 'BOLETO',
           "parcelas" = '[{"duplicata":null,"vencimento":"2026-11-20","valor":874.65,"boleto":null}]';`);
    expect(sql(`SELECT "ativo"::text FROM "centros_custo" WHERE "id" = 'cc1'`)).toBe("true");
    sql(`DELETE FROM "centros_custo" WHERE "id" = 'cc1'`);
    expect(sql(`SELECT COALESCE("centro_custo_id", 'NULL') || '|' || "linha_digitavel" FROM "contas_pagar"`)).toBe("NULL|10492006506100010004200997263900989810000021403");
    expect(sql(`SELECT COALESCE("centro_custo_padrao_id", 'NULL') || '|' || "categoria_padrao_id" FROM "fornecedores"`)).toBe("NULL|cat1");
    sql(`DELETE FROM "categorias_financeiras" WHERE "id" = 'cat1'`);
    expect(sql(`SELECT COALESCE("categoria_padrao_id", 'NULL') FROM "fornecedores"`)).toBe("NULL");
    expect(sql(`SELECT COALESCE("centro_custo_id", 'NULL') || '|' || COALESCE("categoria_id", 'NULL') || '|' || "forma_pagamento" || '|' || ("parcelas"->0->>'valor') FROM "notas_compra"`))
      .toBe("NULL|NULL|BOLETO|874.65");
    expect(() => sql(`INSERT INTO "centros_custo" ("id", "empresa_id", "nome", "atualizado_em") VALUES ('cc2', 'eX', 'X', now())`)).toThrow(/centros_custo_empresa_id_fkey/);
    expect(() => sql(`UPDATE "contas_pagar" SET "centro_custo_id" = 'nao-existe'`)).toThrow(/contas_pagar_centro_custo_id_fkey/);
  });

  it("sem a E2 no banco: para com erro e NÃO altera nada", () => {
    sql(BASE, SEM_E2);
    const erro = erroDe(SEM_E2, ARQUIVO);
    expect(erro).toMatch(/Rode antes o SQL da Leva E2/);
    expect(sql(`SELECT count(*) FROM information_schema.tables WHERE table_schema = '${SEM_E2}' AND table_name = 'centros_custo'`, SEM_E2)).toBe("0");
    expect(colunas("contas_pagar", ["centro_custo_id", "linha_digitavel"], SEM_E2)).toBe("");
    expect(colunas("fornecedores", ["categoria_padrao_id"], SEM_E2)).toBe("");
  });

  it("só com a 1ª versão da E2 (sem o ajuste de conversão): também para e não altera nada", () => {
    sql(BASE, SO_V1);
    psql(SO_V1, ["-f", ARQUIVO_E2_V1]);
    expect(erroDe(SO_V1, ARQUIVO)).toMatch(/versão com o ajuste/);
    expect(sql(`SELECT count(*) FROM information_schema.tables WHERE table_schema = '${SO_V1}' AND table_name = 'centros_custo'`, SO_V1)).toBe("0");
    expect(colunas("notas_compra", ["categoria_id", "parcelas"], SO_V1)).toBe("");
    // rodando a E2 atual por cima, aí a E2.1 passa
    psql(SO_V1, ["-f", ARQUIVO_E2]);
    expect(erroDe(SO_V1, ARQUIVO)).toBeNull();
    expect(colunas("notas_compra", ["categoria_id"], SO_V1)).toBe("categoria_id:text:YES:-");
  });
});
