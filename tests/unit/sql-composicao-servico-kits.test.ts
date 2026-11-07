/**
 * Estoque E3.2 — o SQL de produção (prisma/sql/2026-11-07_composicao_servico_kits.sql) rodado de verdade num
 * PostgreSQL: schema descartável com as tabelas como estão HOJE (depois da E3.1), roda o arquivo DUAS vezes e
 * confere: as 3 tabelas, colunas, índices e FKs (CASCADE do kit/serviço/produto/empresa), que nada se duplica
 * e que SEM a E3.1 (tipo ComportamentoFaturamento) o script para antes de criar qualquer coisa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-composicao-servico-kits
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-07_composicao_servico_kits.sql");
const E31 = path.resolve(__dirname, "../../prisma/sql/2026-11-07_categoria_produto.sql");
const SCHEMA = `teste_composicao_kits_${process.pid}`;
const SEM_E31 = `teste_composicao_sem_e31_${process.pid}`;

function psql(schema: string, args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(schema, ["-c", q]);
const linhas = (q: string) => sql(q).split("\n").filter(Boolean).map((l) => l.split("|"));
const falha = (q: string, schema = SCHEMA) => { try { sql(q, schema); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const rodar = (schema = SCHEMA) => psql(schema, ["-f", ARQUIVO]);
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "servicos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  INSERT INTO "empresas" VALUES ('e1'), ('e2');
  INSERT INTO "produtos" ("id", "empresa_id", "nome") VALUES ('p1', 'e1', 'Gás R410A'), ('p2', 'e1', 'Suporte'), ('pB', 'e2', 'Capacitor');
  INSERT INTO "servicos" ("id", "empresa_id", "nome") VALUES ('s1', 'e1', 'Instalação'), ('sB', 'e2', 'Outra');
`;

describe.skipIf(!URL)("SQL de produção: kits de material + composição do serviço (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, SEM_E31]) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    sql(BASE);
    psql(SCHEMA, ["-f", E31]); // a E3.1 já está em produção
    rodar();
    // Entre a 1ª e a 2ª rodada, dados de verdade: um kit com 2 itens e um serviço com 1 produto solto + o kit
    sql(`
      INSERT INTO "kits_material" ("id", "empresa_id", "nome") VALUES ('k1', 'e1', 'Kit instalação');
      INSERT INTO "kit_material_itens" ("id", "kit_id", "produto_id", "quantidade", "ordem") VALUES ('ki1', 'k1', 'p1', 0.5, 0), ('ki2', 'k1', 'p2', 2, 1);
      INSERT INTO "servico_materiais" ("id", "servico_id", "produto_id", "quantidade", "comportamento", "ordem") VALUES ('sm1', 's1', 'p2', 1, 'VENDA_A_PARTE', 0);
      INSERT INTO "servico_materiais" ("id", "servico_id", "kit_id", "quantidade", "ordem") VALUES ('sm2', 's1', 'k1', 2, 1);
    `);
    rodar();
    sql(BASE, SEM_E31);
  });
  afterAll(() => { for (const s of [SCHEMA, SEM_E31]) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`]); });

  it("cria as 3 tabelas com colunas, índices e FKs; rodar 2x não duplica nem apaga os dados", () => {
    const cols = (t: string) => linhas(`SELECT column_name, is_nullable, COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${t}' ORDER BY ordinal_position`);
    expect(cols("kits_material").map((c) => c[0])).toEqual(["id", "empresa_id", "nome", "descricao", "ativo", "criado_em", "atualizado_em"]);
    expect(cols("kit_material_itens").map((c) => c[0])).toEqual(["id", "kit_id", "produto_id", "quantidade", "ordem"]);
    const sm = cols("servico_materiais");
    expect(sm.map((c) => c[0])).toEqual(["id", "servico_id", "produto_id", "kit_id", "quantidade", "comportamento", "ordem"]);
    expect(Object.fromEntries(sm.map((c) => [c[0], c[1]]))).toMatchObject({ servico_id: "NO", produto_id: "YES", kit_id: "YES", quantidade: "NO", comportamento: "YES", ordem: "NO" });
    expect(sql(`SELECT udt_name FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'servico_materiais' AND column_name = 'comportamento'`)).toBe("ComportamentoFaturamento");
    expect(sql(`SELECT numeric_precision || ',' || numeric_scale FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'kit_material_itens' AND column_name = 'quantidade'`)).toBe("12,3");
    // FKs: kit → empresa; item → kit, produto; material → serviço, produto, kit (todas CASCADE)
    const fks = linhas(`SELECT conrelid::regclass::text, conname, confdeltype FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace AND contype = 'f' AND conrelid::regclass::text IN ('kits_material', 'kit_material_itens', 'servico_materiais') ORDER BY 2`);
    expect(fks.map((f) => f[1])).toEqual(["kit_material_itens_kit_id_fkey", "kit_material_itens_produto_id_fkey", "kits_material_empresa_id_fkey", "servico_materiais_kit_id_fkey", "servico_materiais_produto_id_fkey", "servico_materiais_servico_id_fkey"]);
    expect(new Set(fks.map((f) => f[2]))).toEqual(new Set(["c"]));
    // Índices: pkey + 1 (kit), pkey + 2 (itens), pkey + 3 (materiais)
    expect(linhas(`SELECT tablename, count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename IN ('kits_material', 'kit_material_itens', 'servico_materiais') GROUP BY 1 ORDER BY 1`))
      .toEqual([["kit_material_itens", "3"], ["kits_material", "2"], ["servico_materiais", "4"]]);
    // Nada duplicou nem sumiu na 2ª rodada
    expect(linhas(`SELECT (SELECT count(*) FROM "kits_material"), (SELECT count(*) FROM "kit_material_itens"), (SELECT count(*) FROM "servico_materiais")`)).toEqual([["1", "2", "2"]]);
  });

  it("FKs valem: produto/kit inexistente recusado; apagar o kit leva os itens e a linha do serviço; apagar o serviço leva a composição; apagar a empresa leva tudo", () => {
    expect(falha(`INSERT INTO "kit_material_itens" ("id", "kit_id", "produto_id", "quantidade") VALUES ('x', 'k1', 'nao-existe', 1)`)).toMatch(/foreign key/);
    expect(falha(`INSERT INTO "servico_materiais" ("id", "servico_id", "kit_id", "quantidade") VALUES ('x', 's1', 'nao-existe', 1)`)).toMatch(/foreign key/);
    expect(falha(`INSERT INTO "servico_materiais" ("id", "servico_id", "produto_id", "quantidade", "comportamento") VALUES ('x', 's1', 'p1', 1, 'GRATIS')`)).toMatch(/invalid input value for enum/);
    sql(`INSERT INTO "kits_material" ("id", "empresa_id", "nome") VALUES ('k2', 'e1', 'Kit temporário');
         INSERT INTO "kit_material_itens" ("id", "kit_id", "produto_id", "quantidade") VALUES ('ki3', 'k2', 'p1', 1);
         INSERT INTO "servico_materiais" ("id", "servico_id", "kit_id", "quantidade") VALUES ('sm3', 's1', 'k2', 1);
         DELETE FROM "kits_material" WHERE "id" = 'k2'`);
    expect(sql(`SELECT count(*) FROM "kit_material_itens" WHERE "kit_id" = 'k2'`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "servico_materiais" WHERE "id" = 'sm3'`)).toBe("0");
    sql(`INSERT INTO "servicos" ("id", "empresa_id", "nome") VALUES ('s2', 'e1', 'Temporário');
         INSERT INTO "servico_materiais" ("id", "servico_id", "produto_id", "quantidade") VALUES ('sm4', 's2', 'p1', 1);
         DELETE FROM "servicos" WHERE "id" = 's2'`);
    expect(sql(`SELECT count(*) FROM "servico_materiais" WHERE "id" = 'sm4'`)).toBe("0");
    sql(`INSERT INTO "kits_material" ("id", "empresa_id", "nome") VALUES ('kB', 'e2', 'Kit da outra');
         INSERT INTO "kit_material_itens" ("id", "kit_id", "produto_id", "quantidade") VALUES ('kiB', 'kB', 'pB', 1);
         DELETE FROM "empresas" WHERE "id" = 'e2'`);
    expect(sql(`SELECT count(*) FROM "kits_material" WHERE "empresa_id" = 'e2'`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "kit_material_itens" WHERE "id" = 'kiB'`)).toBe("0");
    // Os dados da e1 ficaram intactos
    expect(linhas(`SELECT (SELECT count(*) FROM "kits_material"), (SELECT count(*) FROM "kit_material_itens"), (SELECT count(*) FROM "servico_materiais")`)).toEqual([["1", "2", "2"]]);
  });

  it("sem a E3.1 (tipo ComportamentoFaturamento) o script PARA no começo, sem criar nada", () => {
    expect(() => rodar(SEM_E31)).toThrow(/Falta a leva E3\.1/);
    expect(sql(`SELECT count(*) FROM information_schema.tables WHERE table_schema = '${SEM_E31}' AND table_name IN ('kits_material', 'kit_material_itens', 'servico_materiais')`, SEM_E31)).toBe("0");
  });
});
