/**
 * Leva 5.2 — o SQL de produção (prisma/sql/2026-10-13_fornecedores.sql) rodado de verdade num
 * PostgreSQL: schema descartável com as tabelas como estão HOJE (conta a pagar com o fornecedor só
 * em texto), roda o arquivo DUAS vezes e confere a criação dos fornecedores e a ligação das contas.
 *
 * Precisa de PostgreSQL + psql: roda quando PG_TESTE_URL está definido (o CI sobe um Postgres).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-fornecedores
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-13_fornecedores.sql");
const SCHEMA = `teste_forn_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8",
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const linhas = (q: string) => sql(q).split("\n").filter(Boolean).map((l) => l.split("|"));

describe.skipIf(!URL)("SQL de produção: fornecedores (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    // Como está em produção ANTES deste SQL (só as colunas que importam aqui)
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contas_pagar" (
        "id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"),
        "fornecedor" TEXT NOT NULL, "fornecedor_cnpj" TEXT, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT now());
      INSERT INTO "empresas" VALUES ('e1'), ('e2');
      INSERT INTO "contas_pagar" ("id", "empresa_id", "fornecedor", "fornecedor_cnpj", "criado_em") VALUES
        ('cp1', 'e1', 'Frigelar Distribuidora', '12.345.678/0001-99', now() - interval '30 days'); -- grafia da conta mais antiga
      INSERT INTO "contas_pagar" ("id", "empresa_id", "fornecedor", "fornecedor_cnpj") VALUES
        ('cp2', 'e1', '  frigelar   distribuidora ', NULL),
        ('cp3', 'e1', 'FRIGELAR DISTRIBUIDORA', '12345678000199'),
        ('cp4', 'e1', 'Posto Ipiranga', '11.111.111/0001-11'),
        ('cp5', 'e1', 'Posto Ipiranga', '22.222.222/0001-22'),
        ('cp6', 'e1', 'Fornecedor a definir', NULL),
        ('cp7', 'e1', '   ', NULL),
        ('cp8', 'e1', 'Loja do Zé', '999'),
        ('cp9', 'e1', 'Outra Frigelar', '12345678000199'),
        ('cpB', 'e2', 'Frigelar Distribuidora', '12345678000199');
    `);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria UM fornecedor por nome (ignorando maiúsculas/espaços) em cada empresa — rodando 2x não duplica", () => {
    const f = linhas(`SELECT "empresa_id", "nome", COALESCE("documento", '-'), "ativo" FROM "fornecedores" ORDER BY 1, 2`);
    expect(f).toEqual([
      ["e1", "Frigelar Distribuidora", "-", "t"], // CNPJ também é de "Outra Frigelar": nenhum dos dois fica com ele
      ["e1", "Loja do Zé", "-", "t"], // "999" não é CNPJ/CPF válido
      ["e1", "Outra Frigelar", "-", "t"],
      ["e1", "Posto Ipiranga", "-", "t"], // dois CNPJs diferentes no texto: não escolhe
      ["e2", "Frigelar Distribuidora", "12345678000199", "t"], // documento único e válido: entra (só dígitos)
    ]);
  });

  it("liga cada conta ao fornecedor da MESMA empresa; genérico e vazio ficam NULL com o texto", () => {
    const r = Object.fromEntries(linhas(`
      SELECT cp."id", COALESCE(f."empresa_id" || ':' || f."nome", 'NULL') FROM "contas_pagar" cp LEFT JOIN "fornecedores" f ON f."id" = cp."fornecedor_id"`));
    expect(r).toEqual({
      cp1: "e1:Frigelar Distribuidora", cp2: "e1:Frigelar Distribuidora", cp3: "e1:Frigelar Distribuidora",
      cp4: "e1:Posto Ipiranga", cp5: "e1:Posto Ipiranga", cp8: "e1:Loja do Zé", cp9: "e1:Outra Frigelar",
      cpB: "e2:Frigelar Distribuidora",
      cp6: "NULL", cp7: "NULL",
    });
    expect(sql(`SELECT "fornecedor" FROM "contas_pagar" WHERE "id" = 'cp6'`)).toBe("Fornecedor a definir");
    expect(sql(`SELECT "fornecedor" = '  frigelar   distribuidora ' FROM "contas_pagar" WHERE "id" = 'cp2'`)).toBe("t"); // texto preservado como estava
  });

  it("já existindo o fornecedor (cadastrado à mão), a nova rodada só liga — não cria outro", () => {
    sql(`INSERT INTO "fornecedores" ("id", "empresa_id", "nome", "atualizado_em") VALUES ('manual', 'e1', 'Refrigeração Polar', now());
         INSERT INTO "contas_pagar" ("id", "empresa_id", "fornecedor") VALUES ('cp10', 'e1', 'refrigeração polar');`);
    psql(["-f", ARQUIVO]);
    expect(sql(`SELECT "fornecedor_id" FROM "contas_pagar" WHERE "id" = 'cp10'`)).toBe("manual");
    expect(sql(`SELECT COUNT(*) FROM "fornecedores" WHERE lower("nome") = 'refrigeração polar'`)).toBe("1");
  });

  it("documento único por empresa (NULL não conflita) e FK com ON DELETE SET NULL", () => {
    expect(() => sql(`INSERT INTO "fornecedores" ("id", "empresa_id", "nome", "documento", "atualizado_em") VALUES ('x1', 'e2', 'Dup', '12345678000199', now())`)).toThrow();
    sql(`INSERT INTO "fornecedores" ("id", "empresa_id", "nome", "documento", "atualizado_em") VALUES ('x2', 'e1', 'Mesmo doc, outra empresa', '12345678000199', now())`);
    expect(sql(`SELECT confdeltype FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${SCHEMA}' AND conname = 'contas_pagar_fornecedor_id_fkey'`)).toBe("n");
    const id = sql(`SELECT "fornecedor_id" FROM "contas_pagar" WHERE "id" = 'cp4'`);
    sql(`DELETE FROM "fornecedores" WHERE "id" = '${id}'`);
    expect(sql(`SELECT COALESCE("fornecedor_id", 'NULL') || '|' || "fornecedor" FROM "contas_pagar" WHERE "id" = 'cp4'`)).toBe("NULL|Posto Ipiranga");
  });
});
