/**
 * Estoque E4.3 — o SQL de produção (prisma/sql/2026-11-08_devolucao_material.sql) rodado de verdade num PostgreSQL:
 * schema descartável com as tabelas como estão HOJE (E3.1 + E3.3b + E4.1 + E4.2 rodados), roda o arquivo DUAS vezes e
 * confere: as colunas da devolução (padrões que deixam a OS antiga idêntica), a FK de quem devolveu (SET NULL), nada
 * duplica; e SEM a E4.2 o script para sem criar nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-devolucao-material
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const sqlDe = (n: string) => path.resolve(__dirname, `../../prisma/sql/${n}`);
const ARQUIVO = sqlDe("2026-11-08_devolucao_material.sql");
const ANTERIORES = ["2026-11-07_categoria_produto.sql", "2026-11-07_materiais_os.sql", "2026-11-07_separacao_material.sql", "2026-11-07_consumo_material.sql"].map(sqlDe);
const SCHEMA = `teste_devolucao_material_${process.pid}`;
const SEM_E42 = `teste_devolucao_material_sem_e42_${process.pid}`;

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
  CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL UNIQUE REFERENCES "empresas"("id") ON DELETE CASCADE);
  CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "servicos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "numero" TEXT NOT NULL);
  CREATE TABLE "os_itens_orcamento" ("id" TEXT PRIMARY KEY, "ordem_servico_id" TEXT NOT NULL REFERENCES "ordens_servico"("id") ON DELETE CASCADE, "orcamento_servico_id" TEXT, "descricao" TEXT NOT NULL, "quantidade" DECIMAL(10,2) NOT NULL, "valor_unitario" DECIMAL(10,2) NOT NULL, "valor_total" DECIMAL(10,2) NOT NULL, "executado" BOOLEAN NOT NULL DEFAULT false, "executado_em" TIMESTAMP(3));
  INSERT INTO "empresas" VALUES ('e1');
  INSERT INTO "usuarios" VALUES ('u1', 'e1', 'Zé'), ('u3', 'e1', 'Almoxarife');
  INSERT INTO "configuracoes" VALUES ('cfg1', 'e1');
  INSERT INTO "produtos" ("id", "empresa_id", "nome") VALUES ('p1', 'e1', 'Tubo');
  INSERT INTO "servicos" ("id", "empresa_id", "nome") VALUES ('s1', 'e1', 'Instalação');
  INSERT INTO "ordens_servico" VALUES ('os1', 'e1', 'OS-1');
  INSERT INTO "os_itens_orcamento" ("id", "ordem_servico_id", "descricao", "quantidade", "valor_unitario", "valor_total") VALUES ('i-serv', 'os1', 'Instalação', 1, 800, 800);
`;

describe.skipIf(!URL)("SQL de produção: devolução de material (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, SEM_E42]) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    sql(BASE);
    for (const a of ANTERIORES) psql(SCHEMA, ["-f", a]);
    // Material consumido com sobra ANTES da E4.3 (a "OS antiga")
    sql(`INSERT INTO "os_materiais" ("id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "origem", "ordem", "quantidade_separada", "estado_separacao", "quantidade_consumida", "consumido_em", "consumido_por_id")
         VALUES ('m-antigo', 'os1', 'i-serv', 'p1', 'Tubo', 'INCLUSO_NO_SERVICO', 5, 3, 20, 'KIT', 0, 5, 'CONSUMIDO', 3, now(), 'u1');`);
    rodar();
    // Entre as rodadas, uma devolução de verdade (como a lib grava)
    sql(`INSERT INTO "os_materiais" ("id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "origem", "ordem", "quantidade_separada", "estado_separacao", "quantidade_consumida", "consumido_em", "quantidade_devolvida", "devolvido_em", "devolvido_por_id")
         VALUES ('m-dev', 'os1', 'i-serv', 'p1', 'Tubo 2', 'INCLUSO_NO_SERVICO', 2, 2, 20, 'SOLTO', 1, 2, 'DEVOLVIDO', 1.5, now(), 0.5, now(), 'u3');`);
    rodar();
    sql(BASE, SEM_E42);
    for (const a of ANTERIORES.slice(0, 3)) psql(SEM_E42, ["-f", a]);
  });
  afterAll(() => { for (const s of [SCHEMA, SEM_E42]) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`]); });

  it("cria as colunas da devolução (padrões 0 / NULL) e a FK de quem devolveu — rodando 2x não duplica", () => {
    expect(linhas(`SELECT column_name, data_type, is_nullable, COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'os_materiais' AND column_name IN ('quantidade_devolvida', 'devolvido_em', 'devolvido_por_id') ORDER BY column_name COLLATE "C"`)).toEqual([
      ["devolvido_em", "timestamp without time zone", "YES", "-"],
      ["devolvido_por_id", "text", "YES", "-"],
      ["quantidade_devolvida", "numeric", "NO", "0"],
    ]);
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conname = 'os_materiais_devolvido_por_id_fkey' AND connamespace = '${SCHEMA}'::regnamespace`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = '${SCHEMA}.os_materiais'::regclass AND contype = 'f'`)).toBe("6"); // OS, item, produto, separou, consumiu, devolveu
  });

  it("OS antiga continua idêntica (sobra pendente, nada devolvido); a devolução gravada entre as rodadas fica; quem devolveu some (SET NULL) se o usuário for apagado", () => {
    expect(linhas(`SELECT "id", "estado_separacao"::text, "quantidade_consumida", "quantidade_devolvida", COALESCE("devolvido_por_id", '∅'), ("devolvido_em" IS NULL)::text FROM "os_materiais" ORDER BY "id" COLLATE "C"`)).toEqual([
      ["m-antigo", "CONSUMIDO", "3.000", "0.000", "∅", "true"],
      ["m-dev", "DEVOLVIDO", "1.500", "0.500", "u3", "false"],
    ]);
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u3'`);
    expect(sql(`SELECT COALESCE("devolvido_por_id", '∅') || '|' || "quantidade_devolvida" FROM "os_materiais" WHERE "id" = 'm-dev'`)).toBe("∅|0.500");
    expect(falha(`UPDATE "os_materiais" SET "devolvido_por_id" = 'nao-existe' WHERE "id" = 'm-antigo'`)).toMatch(/violates foreign key constraint/);
    rodar();
    expect(sql(`SELECT count(*) FROM "os_materiais"`)).toBe("2");
  });

  it("sem a E4.2 o script para no começo e não cria nada", () => {
    expect(tentar(SEM_E42)).toMatch(/Falta a leva E4.2/);
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SEM_E42}' AND table_name = 'os_materiais' AND column_name = 'quantidade_devolvida'`, SEM_E42)).toBe("0");
  });
});
