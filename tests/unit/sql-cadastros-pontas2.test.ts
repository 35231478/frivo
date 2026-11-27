/**
 * Cadastros, leva 5 — os dois SQLs rodados de verdade num PostgreSQL (schema descartável, cada arquivo DUAS vezes):
 *  - prisma/sql/2027-02-02_notas_compra_descartes.sql (🔵, antes do merge): a tabela do registro de descarte;
 *  - docs/sql-opcional/contratos-excluir.sql (OPCIONAL, decisão do Zé): "Contratos › Excluir" para quem já edita.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-cadastros-pontas2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const DESCARTES = path.resolve(__dirname, "../../prisma/sql/2027-02-02_notas_compra_descartes.sql");
const OPCIONAL = path.resolve(__dirname, "../../docs/sql-opcional/contratos-excluir.sql");
const SCHEMA = `teste_sql_cad5_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);

describe.skipIf(!URL)("SQL da leva 5 de cadastros (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL);
      CREATE TABLE "perfis_acesso" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "tipo" TEXT NOT NULL, "permissoes" JSONB NOT NULL);
      INSERT INTO "empresas" VALUES ('e1'), ('e2');
      INSERT INTO "usuarios" VALUES ('u1', 'e1');
      INSERT INTO "perfis_acesso" VALUES
        ('p1', 'Financeiro', 'FINANCEIRO', '{"contratos": {"visualizar": true, "criar": true, "editar": true}}'),
        ('p2', 'Só vê contratos', 'PERSONALIZADO', '{"contratos": {"visualizar": true, "editar": false}}'),
        ('p3', 'Decidido: não cancela', 'PERSONALIZADO', '{"contratos": {"editar": true, "excluir": false}}'),
        ('p4', 'Técnico', 'TECNICO', '{"ordens": {"visualizar": true}}');
    `);
    for (const f of [DESCARTES, DESCARTES, OPCIONAL, OPCIONAL]) psql(["-f", f]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("descartes: a tabela com as colunas do Prisma (tipos, nulos e padrão), a chave e o índice — 2x não duplica", () => {
    const cols = sql(`SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'notas_compra_descartes'`);
    expect(cols.split(",")).toEqual([
      "id:text:NO", "empresa_id:text:NO", "nota_id:text:NO", "chave_acesso:text:NO", "numero:text:NO", "serie:text:NO",
      "emitente_nome:text:NO", "emitente_cnpj:text:NO", "valor_total:numeric:NO", "data_emissao:timestamp without time zone:NO",
      "status_na_hora:text:NO", "motivo:text:YES", "usuario_id:text:YES", "descartado_em:timestamp without time zone:NO",
    ]);
    expect(sql(`SELECT numeric_precision || ',' || numeric_scale FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'notas_compra_descartes' AND column_name = 'valor_total'`)).toBe("12,2");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'notas_compra_descartes_empresa_id_descartado_em_idx'`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace AND conrelid = '"notas_compra_descartes"'::regclass AND contype = 'f'`)).toBe("2");
  });

  it("descartes: quando vem com padrão; usuário apagado vira nulo; empresa apagada leva os registros", () => {
    sql(`INSERT INTO "notas_compra_descartes" ("id", "empresa_id", "nota_id", "chave_acesso", "numero", "serie", "emitente_nome", "emitente_cnpj", "valor_total", "data_emissao", "status_na_hora", "usuario_id")
         VALUES ('d1', 'e1', 'n1', '3526', '45120', '1', 'Refrigeração Paulista', '11222333000144', 2380.50, '2026-11-10', 'IMPORTADA', 'u1'),
                ('d2', 'e2', 'n2', '3527', '45121', '1', 'Outro', '55666777000188', 10, '2026-11-10', 'CONCILIADA', NULL)`);
    expect(sql(`SELECT "descartado_em" IS NOT NULL FROM "notas_compra_descartes" WHERE "id" = 'd1'`)).toBe("t");
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u1'`);
    expect(sql(`SELECT COALESCE("usuario_id", 'NULL') FROM "notas_compra_descartes" WHERE "id" = 'd1'`)).toBe("NULL");
    sql(`DELETE FROM "empresas" WHERE "id" = 'e2'`);
    expect(sql(`SELECT string_agg("id", ',') FROM "notas_compra_descartes"`)).toBe("d1");
  });

  it("opcional: só quem já edita contratos ganha Excluir; o 'não' gravado e os outros perfis ficam como estão", () => {
    const perms = sql(`SELECT string_agg("id" || '=' || COALESCE(("permissoes"->'contratos')::text, ''), ';' ORDER BY "id") FROM "perfis_acesso"`);
    expect(perms.split(";")).toEqual([
      'p1={"criar": true, "editar": true, "excluir": true, "visualizar": true}',
      'p2={"editar": false, "visualizar": true}',
      'p3={"editar": true, "excluir": false}',
      "p4=", // sem a chave "contratos": nada é criado
    ]);
    expect(sql(`SELECT ("permissoes"->'ordens')::text FROM "perfis_acesso" WHERE "id" = 'p4'`)).toBe('{"visualizar": true}');
  });
});
