/**
 * Estoque E4.2 — o SQL de produção (prisma/sql/2026-11-07_consumo_material.sql) rodado de verdade num PostgreSQL:
 * schema descartável com as tabelas como estão HOJE (E1 + E3.1 + E3.3b + E4.1 rodados), roda o arquivo DUAS vezes e
 * confere: as colunas do consumo na os_materiais (padrões que deixam a OS antiga idêntica), a FK de quem consumiu
 * (SET NULL), a flag da amarra na configuração (false), nada duplica; e SEM a E4.1 o script para sem criar nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-consumo-material
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const sqlDe = (n: string) => path.resolve(__dirname, `../../prisma/sql/${n}`);
const ARQUIVO = sqlDe("2026-11-07_consumo_material.sql");
const ANTERIORES = ["2026-11-07_categoria_produto.sql", "2026-11-07_materiais_os.sql", "2026-11-07_separacao_material.sql"].map(sqlDe);
const SCHEMA = `teste_consumo_material_${process.pid}`;
const SEM_E41 = `teste_consumo_material_sem_e41_${process.pid}`;

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
const tentar = (schema: string) => { try { rodar(schema); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const BASE = `
  CREATE TYPE "TipoMovimentacaoEstoque" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'DEVOLUCAO', 'RESERVA');
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL);
  CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE REFERENCES "empresas"("id") ON DELETE CASCADE, "os_exigir_foto" BOOLEAN NOT NULL DEFAULT false);
  CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "servicos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "numero" TEXT NOT NULL);
  CREATE TABLE "os_itens_orcamento" ("id" TEXT PRIMARY KEY, "ordem_servico_id" TEXT NOT NULL REFERENCES "ordens_servico"("id") ON DELETE CASCADE, "orcamento_servico_id" TEXT, "descricao" TEXT NOT NULL, "quantidade" DECIMAL(10,2) NOT NULL, "valor_unitario" DECIMAL(10,2) NOT NULL, "valor_total" DECIMAL(10,2) NOT NULL, "executado" BOOLEAN NOT NULL DEFAULT false, "executado_em" TIMESTAMP(3));
  INSERT INTO "empresas" VALUES ('e1');
  INSERT INTO "usuarios" VALUES ('u1', 'e1', 'Zé'), ('u2', 'e1', 'Carlos');
  INSERT INTO "configuracoes" VALUES ('cfg1', 'e1', true);
  INSERT INTO "produtos" ("id", "empresa_id", "nome") VALUES ('p1', 'e1', 'Tubo');
  INSERT INTO "servicos" ("id", "empresa_id", "nome") VALUES ('s1', 'e1', 'Instalação');
  INSERT INTO "ordens_servico" VALUES ('os1', 'e1', 'OS-1');
  INSERT INTO "os_itens_orcamento" ("id", "ordem_servico_id", "descricao", "quantidade", "valor_unitario", "valor_total") VALUES ('i-serv', 'os1', 'Instalação', 1, 800, 800);
`;

describe.skipIf(!URL)("SQL de produção: consumo de material (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, SEM_E41]) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    sql(BASE);
    for (const a of ANTERIORES) psql(SCHEMA, ["-f", a]);
    // Material separado ANTES da E4.2 (a "OS antiga")
    sql(`INSERT INTO "os_materiais" ("id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "origem", "ordem", "quantidade_separada", "estado_separacao", "separado_por_id")
         VALUES ('m-antigo', 'os1', 'i-serv', 'p1', 'Tubo', 'INCLUSO_NO_SERVICO', 5, 3, 20, 'KIT', 0, 5, 'SEPARADO', 'u1');`);
    rodar();
    // Entre as rodadas, um consumo de verdade (como a lib grava)
    sql(`INSERT INTO "os_materiais" ("id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "origem", "ordem", "quantidade_separada", "estado_separacao", "quantidade_consumida", "consumido_em", "consumido_por_id")
         VALUES ('m-cons', 'os1', 'i-serv', 'p1', 'Tubo 2', 'INCLUSO_NO_SERVICO', 2, 2, 20, 'SOLTO', 1, 2, 'CONSUMIDO', 1.5, now(), 'u2');`);
    sql(`UPDATE "configuracoes" SET "os_exigir_prestacao_material" = true WHERE "id" = 'cfg1'`);
    rodar();
    // Sem a E4.1 (os_materiais sem quantidade_separada)
    sql(BASE, SEM_E41);
    psql(SEM_E41, ["-f", ANTERIORES[0]]);
    psql(SEM_E41, ["-f", ANTERIORES[1]]);
  });
  afterAll(() => { for (const s of [SCHEMA, SEM_E41]) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`]); });

  it("cria as colunas do consumo (padrões 0 / NULL), a FK de quem consumiu e a flag da amarra (false) — rodando 2x não duplica", () => {
    expect(linhas(`SELECT column_name, data_type, is_nullable, COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'os_materiais' AND column_name IN ('quantidade_consumida', 'consumido_em', 'consumido_por_id') ORDER BY column_name COLLATE "C"`)).toEqual([
      ["consumido_em", "timestamp without time zone", "YES", "-"],
      ["consumido_por_id", "text", "YES", "-"],
      ["quantidade_consumida", "numeric", "NO", "0"],
    ]);
    expect(linhas(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'configuracoes' AND column_name = 'os_exigir_prestacao_material'`)).toEqual([["os_exigir_prestacao_material", "boolean", "NO", "false"]]);
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conname = 'os_materiais_consumido_por_id_fkey' AND connamespace = '${SCHEMA}'::regnamespace`)).toBe("1");
  });

  it("OS antiga continua idêntica (separado, nada consumido); o consumo gravado entre as rodadas fica como está; a flag ligada entre as rodadas fica ligada; quem consumiu some (SET NULL) se o usuário for apagado", () => {
    expect(linhas(`SELECT "id", "estado_separacao"::text, "quantidade_separada", "quantidade_consumida", COALESCE("consumido_por_id", '∅'), ("consumido_em" IS NULL)::text FROM "os_materiais" ORDER BY "id" COLLATE "C"`)).toEqual([
      ["m-antigo", "SEPARADO", "5.000", "0.000", "∅", "true"],
      ["m-cons", "CONSUMIDO", "2.000", "1.500", "u2", "false"],
    ]);
    expect(sql(`SELECT "os_exigir_prestacao_material"::text || '|' || "os_exigir_foto"::text FROM "configuracoes" WHERE "id" = 'cfg1'`)).toBe("true|true");
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u2'`);
    expect(sql(`SELECT COALESCE("consumido_por_id", '∅') || '|' || "quantidade_consumida" FROM "os_materiais" WHERE "id" = 'm-cons'`)).toBe("∅|1.500");
    expect(falha(`INSERT INTO "os_materiais" ("id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "comportamento", "quantidade", "valor_venda_unit", "consumido_por_id") VALUES ('m-x', 'os1', 'i-serv', 'p1', 'x', 'INCLUSO_NO_SERVICO', 1, 1, 'nao-existe')`)).toMatch(/violates foreign key constraint/);
    rodar();
    expect(sql(`SELECT count(*) FROM "os_materiais"`)).toBe("2");
  });

  it("sem a E4.1 o script para no começo e não cria nada", () => {
    expect(tentar(SEM_E41)).toMatch(/Falta a leva E4.1/);
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SEM_E41}' AND table_name = 'os_materiais' AND column_name = 'quantidade_consumida'`, SEM_E41)).toBe("0");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SEM_E41}' AND table_name = 'configuracoes' AND column_name = 'os_exigir_prestacao_material'`, SEM_E41)).toBe("0");
  });
});
