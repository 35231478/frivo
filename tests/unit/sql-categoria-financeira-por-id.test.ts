/**
 * Leva 5.1 — o SQL de produção (prisma/sql/2026-10-12_categoria_financeira_por_id.sql) rodado de
 * verdade num PostgreSQL: cria um schema descartável com as tabelas como estão HOJE (conta a receber
 * só com o nome da categoria), roda o arquivo DUAS vezes e confere a migração de dados.
 *
 * Precisa de PostgreSQL + psql: roda quando PG_TESTE_URL está definido (o CI sobe um Postgres para
 * isso). Sem ele o teste é pulado — localmente:
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-categoria
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-12_categoria_financeira_por_id.sql");
const SCHEMA = `teste_l51_${process.pid}`;

/** psql no schema descartável (search_path), parando no primeiro erro. */
function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8",
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const linhas = (q: string) => sql(q).split("\n").filter(Boolean).map((l) => l.split("|"));

describe.skipIf(!URL)("SQL de produção: categoria financeira por id (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    // As tabelas como estão em produção ANTES deste SQL (só as colunas que importam aqui)
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "categorias_financeiras" (
        "id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"), "nome" TEXT NOT NULL,
        "cor" TEXT NOT NULL DEFAULT '#64748B', "ativo" BOOLEAN NOT NULL DEFAULT true, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT now());
      CREATE TABLE "contas_receber" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"), "categoria" TEXT);
      CREATE TABLE "contas_pagar" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"));
      INSERT INTO "empresas" VALUES ('e1'), ('e2');
      INSERT INTO "categorias_financeiras" ("id", "empresa_id", "nome", "ativo", "criado_em") VALUES
        ('cat-mensal', 'e1', 'Contrato mensal', true, now()),
        ('cat-antiga', 'e1', 'Peças (tabela antiga)', false, now()),
        ('cat-dup-velha', 'e1', 'Duplicada', false, now() - interval '2 days'),
        ('cat-dup-ativa', 'e1', 'Duplicada', true, now()),
        ('cat-e2', 'e2', 'Contrato mensal', true, now());
      INSERT INTO "contas_receber" VALUES
        ('cr-mensal', 'e1', 'Contrato mensal'),
        ('cr-antiga', 'e1', 'Peças (tabela antiga)'),
        ('cr-sem-cadastro', 'e1', 'Nome que não existe'),
        ('cr-caixa', 'e1', 'contrato mensal'),
        ('cr-dup', 'e1', 'Duplicada'),
        ('cr-vazia', 'e1', NULL),
        ('cr-e2', 'e2', 'Contrato mensal');
      INSERT INTO "contas_pagar" VALUES ('cp1', 'e1');
    `);
    // Duas vezes: idempotente (nada de erro, nada de efeito repetido)
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("conta antiga passa a apontar para a categoria certa (por id), só da mesma empresa", () => {
    const r = Object.fromEntries(linhas(`SELECT "id", COALESCE("categoria_id", 'NULL') FROM "contas_receber"`));
    expect(r).toEqual({
      "cr-mensal": "cat-mensal",
      "cr-antiga": "cat-antiga", // categoria inativa já usada: continua ligada
      "cr-dup": "cat-dup-ativa", // nome repetido na empresa: vale a ativa
      "cr-e2": "cat-e2", // nunca a categoria de outra empresa
      "cr-sem-cadastro": "NULL", // não casou: não inventa categoria
      "cr-caixa": "NULL", // match exato (maiúsculas contam)
      "cr-vazia": "NULL",
    });
  });

  it("o texto antigo da categoria fica (histórico/fallback); nenhuma categoria é criada", () => {
    expect(sql(`SELECT "categoria" FROM "contas_receber" WHERE "id" = 'cr-sem-cadastro'`)).toBe("Nome que não existe");
    expect(sql(`SELECT COUNT(*) FROM "categorias_financeiras"`)).toBe("5");
  });

  it("conta a pagar ganha a coluna; FK com ON DELETE SET NULL nas duas tabelas", () => {
    expect(sql(`SELECT COALESCE("categoria_id", 'NULL') FROM "contas_pagar" WHERE "id" = 'cp1'`)).toBe("NULL");
    const fks = linhas(`SELECT c."conname", c."confdeltype" FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = '${SCHEMA}' AND c."conname" LIKE '%categoria_id_fkey' ORDER BY 1`);
    expect(fks).toEqual([["contas_pagar_categoria_id_fkey", "n"], ["contas_receber_categoria_id_fkey", "n"]]);
    sql(`UPDATE "contas_pagar" SET "categoria_id" = 'cat-mensal' WHERE "id" = 'cp1'`);
    sql(`DELETE FROM "categorias_financeiras" WHERE "id" = 'cat-mensal'`);
    expect(sql(`SELECT COALESCE("categoria_id", 'NULL') FROM "contas_pagar" WHERE "id" = 'cp1'`)).toBe("NULL");
    expect(sql(`SELECT COALESCE("categoria_id", 'NULL') FROM "contas_receber" WHERE "id" = 'cr-mensal'`)).toBe("NULL");
  });

  it("categoria_id inexistente é barrado pela FK (a empresa é conferida no código: validarRefEmpresa)", () => {
    expect(() => sql(`UPDATE "contas_receber" SET "categoria_id" = 'nao-existe' WHERE "id" = 'cr-vazia'`)).toThrow();
  });
});
