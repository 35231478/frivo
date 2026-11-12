/**
 * Estoque E4.1 — o SQL de produção (prisma/sql/2026-11-07_separacao_material.sql) rodado de verdade num PostgreSQL:
 * schema descartável com as tabelas como estão HOJE (E1 + E3.1 + E3.3b rodados), roda o arquivo DUAS vezes e confere:
 * o tipo, as colunas novas da os_materiais (padrões que deixam a OS antiga idêntica), o índice, a FK de quem separou
 * (SET NULL), enum inválido recusado, nada duplica; e SEM a E3.3b (ou sem o RESERVA da E1) o script para sem criar nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-separacao-material
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-07_separacao_material.sql");
const E31 = path.resolve(__dirname, "../../prisma/sql/2026-11-07_categoria_produto.sql");
const E33B = path.resolve(__dirname, "../../prisma/sql/2026-11-07_materiais_os.sql");
const SCHEMA = `teste_separacao_material_${process.pid}`;
const SEM_E33B = `teste_separacao_material_sem_e33b_${process.pid}`;
const SEM_RESERVA = `teste_separacao_material_sem_reserva_${process.pid}`;

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
const tentar = (schema: string) => { try { rodar(schema); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
/** As tabelas de hoje (antes da E3.1/E3.3b), com o razão da E1 (com RESERVA) */
const BASE = (comReserva = true) => `
  CREATE TYPE "TipoMovimentacaoEstoque" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'DEVOLUCAO'${comReserva ? ", 'RESERVA'" : ""});
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL);
  CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "servicos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE, "numero" TEXT NOT NULL);
  CREATE TABLE "os_itens_orcamento" ("id" TEXT PRIMARY KEY, "ordem_servico_id" TEXT NOT NULL REFERENCES "ordens_servico"("id") ON DELETE CASCADE, "orcamento_servico_id" TEXT, "descricao" TEXT NOT NULL, "quantidade" DECIMAL(10,2) NOT NULL, "valor_unitario" DECIMAL(10,2) NOT NULL, "valor_total" DECIMAL(10,2) NOT NULL, "executado" BOOLEAN NOT NULL DEFAULT false, "executado_em" TIMESTAMP(3));
  INSERT INTO "empresas" VALUES ('e1');
  INSERT INTO "usuarios" VALUES ('u1', 'e1', 'Zé'), ('u2', 'e1', 'Ana');
  INSERT INTO "produtos" ("id", "empresa_id", "nome") VALUES ('p1', 'e1', 'Tubo'), ('p2', 'e1', 'Capacitor');
  INSERT INTO "servicos" ("id", "empresa_id", "nome") VALUES ('s1', 'e1', 'Instalação');
  INSERT INTO "ordens_servico" VALUES ('os1', 'e1', 'OS-1');
  INSERT INTO "os_itens_orcamento" ("id", "ordem_servico_id", "descricao", "quantidade", "valor_unitario", "valor_total", "executado") VALUES ('i-serv', 'os1', 'Instalação', 1, 800, 800, false);
`;

describe.skipIf(!URL)("SQL de produção: separação de material (PostgreSQL real)", () => {
  beforeAll(() => {
    for (const s of [SCHEMA, SEM_E33B, SEM_RESERVA]) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    sql(BASE());
    psql(SCHEMA, ["-f", E31]);
    psql(SCHEMA, ["-f", E33B]);
    // Material da E3.3b já existente ANTES da E4.1 (a "OS antiga")
    sql(`INSERT INTO "os_materiais" ("id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "origem", "ordem")
         VALUES ('m-antigo', 'os1', 'i-serv', 'p1', 'Tubo', 'INCLUSO_NO_SERVICO', 5, 3, 20, 'KIT', 0);`);
    rodar();
    // Entre as rodadas, uma separação de verdade (como a lib grava)
    sql(`INSERT INTO "os_materiais" ("id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "comportamento", "quantidade", "quantidade_padrao", "valor_venda_unit", "origem", "ordem", "quantidade_separada", "estado_separacao", "separado_em", "separado_por_id")
         VALUES ('m-sep', 'os1', 'i-serv', 'p2', 'Capacitor', 'VENDA_A_PARTE', 1, 1, 80, 'SOLTO', 1, 1, 'SEPARADO', now(), 'u1');`);
    rodar();
    sql(BASE(), SEM_E33B);
    sql(BASE(false), SEM_RESERVA);
    psql(SEM_RESERVA, ["-f", E31]);
    psql(SEM_RESERVA, ["-f", E33B]);
  });
  afterAll(() => { for (const s of [SCHEMA, SEM_E33B, SEM_RESERVA]) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`]); });

  it("cria o tipo (SEPARADO/CONSUMIDO/DEVOLVIDO), as colunas com os padrões (0 / NULL) e o índice — rodando 2x não duplica", () => {
    expect(sql(`SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'EstadoSeparacaoMaterial' AND n.nspname = '${SCHEMA}'`))
      .toBe("SEPARADO,CONSUMIDO,DEVOLVIDO");
    expect(linhas(`SELECT column_name, data_type, is_nullable, COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'os_materiais' AND column_name IN ('quantidade_separada', 'estado_separacao', 'separado_em', 'separado_por_id') ORDER BY column_name COLLATE "C"`)).toEqual([
      ["estado_separacao", "USER-DEFINED", "YES", "-"],
      ["quantidade_separada", "numeric", "NO", "0"],
      ["separado_em", "timestamp without time zone", "YES", "-"],
      ["separado_por_id", "text", "YES", "-"],
    ]);
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'os_materiais_ordem_servico_id_estado_separacao_idx'`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conname = 'os_materiais_separado_por_id_fkey' AND connamespace = '${SCHEMA}'::regnamespace`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'EstadoSeparacaoMaterial' AND n.nspname = '${SCHEMA}'`)).toBe("1");
  });

  it("OS antiga continua idêntica (nada separado); a separação gravada entre as rodadas fica como está; quem separou some (SET NULL) se o usuário for apagado; estado fora da lista é recusado; nada apaga o razão", () => {
    expect(linhas(`SELECT "id", "quantidade_separada", COALESCE("estado_separacao"::text, '∅'), COALESCE("separado_por_id", '∅'), ("separado_em" IS NULL)::text FROM "os_materiais" ORDER BY "id" COLLATE "C"`)).toEqual([
      ["m-antigo", "0.000", "∅", "∅", "true"],
      ["m-sep", "1.000", "SEPARADO", "u1", "false"],
    ]);
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u1'`);
    expect(sql(`SELECT COALESCE("separado_por_id", '∅') || '|' || "estado_separacao"::text FROM "os_materiais" WHERE "id" = 'm-sep'`)).toBe("∅|SEPARADO");
    expect(falha(`UPDATE "os_materiais" SET "estado_separacao" = 'PERDIDO' WHERE "id" = 'm-antigo'`)).toMatch(/invalid input value for enum/);
    expect(falha(`INSERT INTO "os_materiais" ("id", "ordem_servico_id", "os_item_id", "produto_id", "descricao", "comportamento", "quantidade", "valor_venda_unit", "separado_por_id") VALUES ('m-x', 'os1', 'i-serv', 'p1', 'x', 'INCLUSO_NO_SERVICO', 1, 1, 'nao-existe')`)).toMatch(/violates foreign key constraint/);
    // Rodar de novo depois dos dados: nada muda
    rodar();
    expect(sql(`SELECT count(*) FROM "os_materiais"`)).toBe("2");
    expect(sql(`SELECT "quantidade_separada" FROM "os_materiais" WHERE "id" = 'm-sep'`)).toBe("1.000");
  });

  it("sem a E3.3b (os_materiais) ou sem o RESERVA da E1 o script para no começo e não cria nada", () => {
    expect(tentar(SEM_E33B)).toMatch(/Falta a leva E3.3b/);
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'EstadoSeparacaoMaterial' AND n.nspname = '${SEM_E33B}'`, SEM_E33B)).toBe("0");
    expect(tentar(SEM_RESERVA)).toMatch(/Falta a leva E1 \(complemento\)/);
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'EstadoSeparacaoMaterial' AND n.nspname = '${SEM_RESERVA}'`, SEM_RESERVA)).toBe("0");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SEM_RESERVA}' AND table_name = 'os_materiais' AND column_name = 'quantidade_separada'`, SEM_RESERVA)).toBe("0");
  });
});
