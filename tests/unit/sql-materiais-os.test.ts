/**
 * Estoque E3.3b — o SQL de produção (prisma/sql/2026-11-07_materiais_os.sql) rodado de verdade num PostgreSQL:
 * schema descartável com as tabelas como estão HOJE (depois da E3.1; a E3.3 pode ou não ter rodado), roda o
 * arquivo DUAS vezes e confere: os tipos, as colunas novas do item da OS (com os padrões que deixam a OS antiga
 * idêntica), a tabela do snapshot (colunas, índices, FKs CASCADE/SET NULL), material_id único, cascatas,
 * nada duplica, e SEM a E3.1 o script para sem criar nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-materiais-os
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-07_materiais_os.sql");
const E31 = path.resolve(__dirname, "../../prisma/sql/2026-11-07_categoria_produto.sql");
const SCHEMA = `teste_materiais_os_${process.pid}`;
const SEM_E31 = `teste_materiais_os_sem_e31_${process.pid}`;

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
  CREATE TABLE "servicos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "numero" TEXT NOT NULL);
  CREATE TABLE "os_itens_orcamento" ("id" TEXT PRIMARY KEY, "ordem_servico_id" TEXT NOT NULL REFERENCES "ordens_servico"("id") ON DELETE CASCADE, "orcamento_servico_id" TEXT, "descricao" TEXT NOT NULL, "quantidade" DECIMAL(10,2) NOT NULL, "valor_unitario" DECIMAL(10,2) NOT NULL, "valor_total" DECIMAL(10,2) NOT NULL, "executado" BOOLEAN NOT NULL DEFAULT false, "executado_em" TIMESTAMP(3));
  INSERT INTO "empresas" VALUES ('e1');
  INSERT INTO "produtos" ("id", "empresa_id", "nome") VALUES ('p1', 'e1', 'Tubo'), ('p2', 'e1', 'Capacitor');
  INSERT INTO "servicos" ("id", "empresa_id", "nome") VALUES ('s1', 'e1', 'Instalação');
  INSERT INTO "ordens_servico" VALUES ('os1', 'e1', 'OS-1');
  INSERT INTO "os_itens_orcamento" ("id", "ordem_servico_id", "descricao", "quantidade", "valor_unitario", "valor_total", "executado") VALUES ('i-antigo', 'os1', 'Item antigo', 1, 800, 800, true);
`;

describe.skipIf(!URL)("SQL de produção: materiais da OS (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, SEM_E31]) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    sql(BASE);
    psql(SCHEMA, ["-f", E31]);
    rodar();
    // Entre as rodadas, dados de verdade: um serviço com material incluso + peça, e a peça derivada como item PRODUTO
    sql(`
      INSERT INTO "os_itens_orcamento" ("id", "ordem_servico_id", "descricao", "quantidade", "valor_unitario", "valor_total", "tipo", "servico_id", "valor_base", "ajuste_materiais", "ordem")
        VALUES ('i-serv', 'os1', 'Instalação', 1, 840, 840, 'SERVICO', 's1', 800, 40, 1);
      INSERT INTO "os_materiais" ("id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "custo_unit", "origem", "kit_nome", "ordem")
        VALUES ('m1', 'os1', 'i-serv', 'p1', 'Tubo', 'INCLUSO_NO_SERVICO', 5, 3, 20, 12, 'KIT', 'Kit instalação', 0),
               ('m2', 'os1', 'i-serv', 'p2', 'Capacitor', 'VENDA_A_PARTE', 1, 1, 80, NULL, 'SOLTO', NULL, 1);
      INSERT INTO "os_itens_orcamento" ("id", "ordem_servico_id", "descricao", "quantidade", "valor_unitario", "valor_total", "tipo", "produto_id", "material_id", "ordem")
        VALUES ('i-peca', 'os1', 'Capacitor', 1, 80, 80, 'PRODUTO', 'p2', 'm2', 2);
    `);
    rodar();
    sql(BASE, SEM_E31);
  });
  afterAll(() => { for (const s of [SCHEMA, SEM_E31]) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`]); });

  it("tipos, colunas do item (padrões que não mudam a OS antiga), tabela do snapshot, índices e FKs; 2x não duplica nem apaga", () => {
    expect(sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'TipoItemOs' AND n.nspname = '${SCHEMA}'`)).toBe("SERVICO,PRODUTO");
    expect(sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'OrigemMaterialOrcamento' AND n.nspname = '${SCHEMA}'`)).toBe("SOLTO,KIT,AVULSO");
    const cols = (t: string) => linhas(`SELECT column_name, is_nullable, COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${t}' ORDER BY ordinal_position`);
    const item = Object.fromEntries(cols("os_itens_orcamento").map((c) => [c[0], [c[1], c[2]]]));
    expect(item.tipo).toEqual(["NO", "'SERVICO'::\"TipoItemOs\""]);
    expect(item.servico_id).toEqual(["YES", "-"]); expect(item.produto_id).toEqual(["YES", "-"]);
    expect(item.valor_base).toEqual(["YES", "-"]); expect(item.ajuste_materiais).toEqual(["NO", "0"]); expect(item.valor_manual).toEqual(["NO", "false"]);
    expect(item.material_id).toEqual(["YES", "-"]); expect(item.ordem).toEqual(["NO", "0"]);
    expect(cols("os_materiais").map((c) => c[0])).toEqual(["id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "unidade", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "custo_unit", "origem", "kit_nome", "ordem"]);
    const fks = linhas(`SELECT conname, confdeltype FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace AND contype = 'f' AND conrelid::regclass::text IN ('os_materiais', 'os_itens_orcamento') ORDER BY 1`);
    expect(fks).toEqual([
      ["os_itens_orcamento_material_id_fkey", "c"], ["os_itens_orcamento_ordem_servico_id_fkey", "c"], ["os_itens_orcamento_produto_id_fkey", "n"], ["os_itens_orcamento_servico_id_fkey", "n"],
      ["os_materiais_ordem_servico_id_fkey", "c"], ["os_materiais_os_item_id_fkey", "c"], ["os_materiais_produto_id_fkey", "n"],
    ]);
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'os_materiais'`)).toBe("4");
    expect(sql(`SELECT indexdef FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'os_itens_orcamento_material_id_key'`)).toMatch(/UNIQUE/);
    // O item antigo ficou idêntico: serviço, sem catálogo, sem base, ajuste 0, manual falso, ordem 0
    expect(linhas(`SELECT "tipo", "servico_id" IS NULL, "valor_base" IS NULL, "ajuste_materiais", "valor_manual", "ordem", "valor_total", "executado" FROM "os_itens_orcamento" WHERE "id" = 'i-antigo'`)).toEqual([["SERVICO", "t", "t", "0.00", "f", "0", "800.00", "t"]]);
    expect(linhas(`SELECT (SELECT count(*) FROM "os_materiais"), (SELECT count(*) FROM "os_itens_orcamento")`)).toEqual([["2", "3"]]);
  });

  it("cascatas: apagar o material some com a peça derivada; apagar o item some com os materiais; apagar o produto/serviço só anula o vínculo; material_id único; enum inválido recusado", () => {
    expect(falha(`INSERT INTO "os_itens_orcamento" ("id", "ordem_servico_id", "descricao", "quantidade", "valor_unitario", "valor_total", "material_id") VALUES ('x', 'os1', 'Dup', 1, 1, 1, 'm2')`)).toMatch(/unique|duplicate/i);
    expect(falha(`INSERT INTO "os_itens_orcamento" ("id", "ordem_servico_id", "descricao", "quantidade", "valor_unitario", "valor_total", "tipo") VALUES ('x', 'os1', 'X', 1, 1, 1, 'KIT')`)).toMatch(/invalid input value for enum/);
    sql(`DELETE FROM "produtos" WHERE "id" = 'p1'; DELETE FROM "servicos" WHERE "id" = 's1'`);
    expect(linhas(`SELECT "produto_id" IS NULL, "descricao", "quantidade" FROM "os_materiais" WHERE "id" = 'm1'`)).toEqual([["t", "Tubo", "5.000"]]);
    expect(linhas(`SELECT "servico_id" IS NULL, "valor_total" FROM "os_itens_orcamento" WHERE "id" = 'i-serv'`)).toEqual([["t", "840.00"]]);
    sql(`DELETE FROM "os_materiais" WHERE "id" = 'm2'`);
    expect(sql(`SELECT count(*) FROM "os_itens_orcamento" WHERE "id" = 'i-peca'`)).toBe("0");
    sql(`DELETE FROM "os_itens_orcamento" WHERE "id" = 'i-serv'`);
    expect(sql(`SELECT count(*) FROM "os_materiais"`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "os_itens_orcamento"`)).toBe("1"); // o antigo fica
  });

  it("sem a E3.1 o script PARA no começo, sem criar nada", () => {
    expect(() => rodar(SEM_E31)).toThrow(/Falta a leva E3\.1/);
    expect(sql(`SELECT count(*) FROM information_schema.tables WHERE table_schema = '${SEM_E31}' AND table_name = 'os_materiais'`, SEM_E31)).toBe("0");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SEM_E31}' AND table_name = 'os_itens_orcamento' AND column_name = 'tipo'`, SEM_E31)).toBe("0");
  });
});
