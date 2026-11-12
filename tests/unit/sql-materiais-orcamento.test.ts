/**
 * Estoque E3.3 — o SQL de produção (prisma/sql/2026-11-07_materiais_orcamento.sql) rodado de verdade num
 * PostgreSQL: schema descartável com as tabelas como estão HOJE (depois da E3.1), roda o arquivo DUAS vezes e
 * confere: o tipo, as 3 colunas novas da linha de serviço (com os padrões que deixam o orçamento antigo igual),
 * a tabela do snapshot (colunas, índices, FKs CASCADE/SET NULL), material_id único na linha de produto, nada
 * duplica, cascatas valem, e SEM a E3.1 o script para sem criar nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-materiais-orcamento
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-07_materiais_orcamento.sql");
const E31 = path.resolve(__dirname, "../../prisma/sql/2026-11-07_categoria_produto.sql");
const SCHEMA = `teste_materiais_orc_${process.pid}`;
const SEM_E31 = `teste_materiais_orc_sem_e31_${process.pid}`;

function psql(schema: string, args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(schema, ["-c", q]);
const linhas = (q: string) => sql(q).split("\n").filter(Boolean).map((l) => l.split("|"));
const falha = (q: string) => { try { sql(q); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const rodar = (schema = SCHEMA) => psql(schema, ["-f", ARQUIVO]);
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "orcamentos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "codigo" TEXT NOT NULL);
  CREATE TABLE "orcamento_servicos" ("id" TEXT PRIMARY KEY, "orcamento_id" TEXT NOT NULL REFERENCES "orcamentos"("id") ON DELETE CASCADE, "descricao" TEXT NOT NULL, "quantidade" DECIMAL(10,2) NOT NULL DEFAULT 1, "valor_unitario" DECIMAL(12,2) NOT NULL, "valor_total" DECIMAL(12,2) NOT NULL, "ordem" INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE "orcamento_produtos" ("id" TEXT PRIMARY KEY, "orcamento_id" TEXT NOT NULL REFERENCES "orcamentos"("id") ON DELETE CASCADE, "produto_id" TEXT, "descricao" TEXT NOT NULL, "quantidade" DECIMAL(10,2) NOT NULL DEFAULT 1, "valor_unitario" DECIMAL(12,2) NOT NULL, "valor_total" DECIMAL(12,2) NOT NULL, "ordem" INTEGER NOT NULL DEFAULT 0);
  INSERT INTO "empresas" VALUES ('e1');
  INSERT INTO "produtos" ("id", "empresa_id", "nome") VALUES ('p1', 'e1', 'Tubo'), ('p2', 'e1', 'Capacitor');
  INSERT INTO "orcamentos" VALUES ('o1', 'e1', 'ORC-1');
  INSERT INTO "orcamento_servicos" ("id", "orcamento_id", "descricao", "valor_unitario", "valor_total") VALUES ('s1', 'o1', 'Instalação antiga', 800, 800);
`;

describe.skipIf(!URL)("SQL de produção: materiais do orçamento (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, SEM_E31]) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    sql(BASE);
    psql(SCHEMA, ["-f", E31]);
    rodar();
    // Entre as rodadas, dados de verdade: um material incluso e uma peça com a linha de produto derivada
    sql(`
      INSERT INTO "orcamento_materiais" ("id", "orcamento_id", "orcamento_servico_id", "produto_id", "descricao", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "custo_unit", "origem", "kit_nome", "ordem")
        VALUES ('m1', 'o1', 's1', 'p1', 'Tubo', 'INCLUSO_NO_SERVICO', 5, 3, 20, 12, 'KIT', 'Kit instalação', 0),
               ('m2', 'o1', 's1', 'p2', 'Capacitor', 'VENDA_A_PARTE', 2, 1, 80, NULL, 'SOLTO', NULL, 1);
      INSERT INTO "orcamento_produtos" ("id", "orcamento_id", "produto_id", "descricao", "quantidade", "valor_unitario", "valor_total", "material_id") VALUES ('pp1', 'o1', 'p2', 'Capacitor', 2, 80, 160, 'm2');
      UPDATE "orcamento_servicos" SET "valor_base" = 800, "ajuste_materiais" = 40, "valor_total" = 840 WHERE "id" = 's1';
    `);
    rodar();
    sql(BASE, SEM_E31);
  });
  afterAll(() => { for (const s of [SCHEMA, SEM_E31]) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`]); });

  it("tipo, colunas da linha de serviço (padrões que não mudam o antigo), tabela do snapshot, índices e FKs; 2x não duplica nem apaga", () => {
    expect(sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'OrigemMaterialOrcamento' AND n.nspname = '${SCHEMA}'`)).toBe("SOLTO,KIT,AVULSO");
    const cols = (t: string) => linhas(`SELECT column_name, is_nullable, COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${t}' ORDER BY ordinal_position`);
    const serv = Object.fromEntries(cols("orcamento_servicos").map((c) => [c[0], [c[1], c[2]]]));
    expect(serv.valor_base).toEqual(["YES", "-"]);
    expect(serv.ajuste_materiais).toEqual(["NO", "0"]);
    expect(serv.valor_manual).toEqual(["NO", "false"]);
    expect(cols("orcamento_materiais").map((c) => c[0])).toEqual(["id", "orcamento_id", "orcamento_servico_id", "produto_id", "descricao", "unidade", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "custo_unit", "origem", "kit_nome", "ordem"]);
    expect(Object.fromEntries(cols("orcamento_materiais").map((c) => [c[0], c[1]]))).toMatchObject({ produto_id: "YES", comportamento: "NO", quantidade: "NO", custo_unit: "YES", kit_nome: "YES" });
    expect(sql(`SELECT udt_name FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'orcamento_materiais' AND column_name = 'comportamento'`)).toBe("ComportamentoFaturamento");
    expect(sql(`SELECT numeric_precision || ',' || numeric_scale FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'orcamento_materiais' AND column_name = 'custo_unit'`)).toBe("14,4");
    const fks = linhas(`SELECT conname, confdeltype FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace AND contype = 'f' AND conrelid::regclass::text IN ('orcamento_materiais', 'orcamento_produtos') ORDER BY 1`);
    expect(fks).toEqual([
      ["orcamento_materiais_orcamento_id_fkey", "c"], ["orcamento_materiais_orcamento_servico_id_fkey", "c"], ["orcamento_materiais_produto_id_fkey", "n"],
      ["orcamento_produtos_material_id_fkey", "c"], ["orcamento_produtos_orcamento_id_fkey", "c"],
    ]);
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'orcamento_materiais'`)).toBe("4"); // pkey + 3
    expect(sql(`SELECT indexdef FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'orcamento_produtos_material_id_key'`)).toMatch(/UNIQUE/);
    // O serviço antigo continua igual (sem base, ajuste 0, manual falso)
    expect(linhas(`SELECT "valor_base" IS NULL, "ajuste_materiais", "valor_manual", "valor_total" FROM "orcamento_servicos" WHERE "id" = 's1'`)).toEqual([["f", "40.00", "f", "840.00"]]);
    expect(linhas(`SELECT (SELECT count(*) FROM "orcamento_materiais"), (SELECT count(*) FROM "orcamento_produtos")`)).toEqual([["2", "1"]]);
  });

  it("cascatas: apagar o material some com a peça derivada; apagar a linha do serviço some com os materiais; apagar o produto do catálogo só anula o vínculo (o snapshot fica); material_id é único", () => {
    expect(falha(`INSERT INTO "orcamento_produtos" ("id", "orcamento_id", "descricao", "valor_unitario", "valor_total", "material_id") VALUES ('pp2', 'o1', 'Dup', 1, 1, 'm2')`)).toMatch(/unique|duplicate/i);
    expect(falha(`INSERT INTO "orcamento_materiais" ("id", "orcamento_id", "orcamento_servico_id", "descricao", "comportamento", "quantidade", "valor_venda_unit") VALUES ('x', 'o1', 's1', 'X', 'GRATIS', 1, 1)`)).toMatch(/invalid input value for enum/);
    sql(`DELETE FROM "produtos" WHERE "id" = 'p1'`);
    expect(linhas(`SELECT "produto_id" IS NULL, "descricao", "quantidade" FROM "orcamento_materiais" WHERE "id" = 'm1'`)).toEqual([["t", "Tubo", "5.000"]]);
    sql(`DELETE FROM "orcamento_materiais" WHERE "id" = 'm2'`);
    expect(sql(`SELECT count(*) FROM "orcamento_produtos" WHERE "id" = 'pp1'`)).toBe("0");
    sql(`DELETE FROM "orcamento_servicos" WHERE "id" = 's1'`);
    expect(sql(`SELECT count(*) FROM "orcamento_materiais"`)).toBe("0");
  });

  it("sem a E3.1 o script PARA no começo, sem criar nada", () => {
    expect(() => rodar(SEM_E31)).toThrow(/Falta a leva E3\.1/);
    expect(sql(`SELECT count(*) FROM information_schema.tables WHERE table_schema = '${SEM_E31}' AND table_name = 'orcamento_materiais'`, SEM_E31)).toBe("0");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SEM_E31}' AND table_name = 'orcamento_servicos' AND column_name = 'valor_base'`, SEM_E31)).toBe("0");
  });
});
