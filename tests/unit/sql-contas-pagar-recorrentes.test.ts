/**
 * O SQL de produção (prisma/sql/2027-01-04_contas_pagar_recorrentes.sql) rodado de verdade num
 * PostgreSQL descartável, POR CIMA de um banco com contas a pagar já em uso:
 *  - cria UMA tabela (a regra) e acrescenta CINCO colunas opcionais em "contas_pagar" — e mais nada;
 *  - as contas que já existem continuam iguais, linha por linha, com os valores de antes;
 *  - o índice único (recorrencia, ano, mês) impede a mesma competência duas vezes, e não atrapalha
 *    as contas avulsas (NULL não conflita com NULL no Postgres);
 *  - apagar a REGRA não apaga conta nenhuma (SET NULL): o histórico de pagamento fica;
 *  - é idempotente (roda três vezes, com dados gravados, sem erro e sem mudar nada);
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-contas-pagar-recorrentes
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 120_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-04_contas_pagar_recorrentes.sql");
const SCHEMA = `teste_rec_sql_${process.pid}`;
const PRISMA = `teste_rec_prisma_${process.pid}`;
const NOVAS = ["contas_pagar_recorrencias"];
const T = "contas_pagar", R = "contas_pagar_recorrencias";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção hoje: o que o arquivo referencia, com contas a pagar já em uso */
const BASE = `
  CREATE TYPE "FormaPagamento" AS ENUM ('BOLETO', 'PIX', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO', 'CHEQUE');
  CREATE TYPE "StatusContaPagar" AS ENUM ('PENDENTE', 'PAGO_PARCIAL', 'PAGO_TOTAL', 'VENCIDO', 'CANCELADO');
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "fornecedores" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "categorias_financeiras" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "centros_custo" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "contas_pagar" (
    "id" TEXT PRIMARY KEY,
    "empresa_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "fornecedor_id" TEXT,
    "fornecedor" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor_total" DECIMAL(12,2) NOT NULL,
    "valor_pago" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo_restante" DECIMAL(12,2) NOT NULL,
    "status" "StatusContaPagar" NOT NULL DEFAULT 'PENDENTE',
    "data_vencimento" TIMESTAMP(3),
    "forma_pagamento" "FormaPagamento",
    "categoria_id" TEXT,
    "centro_custo_id" TEXT,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL
  );
  CREATE UNIQUE INDEX "contas_pagar_numero_empresa_id_key" ON "contas_pagar" ("numero", "empresa_id");
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total'), ('e2', 'Outra');
  INSERT INTO "fornecedores" VALUES ('f1', 'e1', 'Imobiliária Centro');
  INSERT INTO "tecnicos" VALUES ('t1', 'e1', 'Carlos Dias');
  INSERT INTO "contas_pagar" ("id", "empresa_id", "numero", "fornecedor_id", "fornecedor", "descricao", "valor_total", "valor_pago", "saldo_restante", "status", "data_vencimento", "atualizado_em")
    VALUES ('cp1', 'e1', 'CP-1', 'f1', 'Imobiliária Centro', 'Aluguel de novembro', 2500.00, 2500.00, 0, 'PAGO_TOTAL', '2026-11-10', now()),
           ('cp2', 'e1', 'CP-2', NULL, 'Papelaria', 'Material de escritório', 320.50, 0, 320.50, 'PENDENTE', '2026-11-20', now());
`;

const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(numeric_precision::text, '-') || ',' || coalesce(numeric_scale::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`).split(",");
const linhas = (tabela: string) => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM "${tabela}" t`);
const retrato = (lista: string[]) => lista.map((t) => `${t}\n${colunas(SCHEMA, t)}\n${indices(SCHEMA, t)}\n${chaves(SCHEMA, t)}\n${linhas(t)}`).join("\n=====\n");

const regra = (id: string, empresa = "e1", extra = "") =>
  sql(`INSERT INTO "${R}" ("id", "empresa_id", "descricao", "fornecedor_id", "favorecido_nome", "dia_vencimento", "valor", "inicio_ano", "inicio_mes", "atualizado_em"${extra ? ', "situacao"' : ""})
    VALUES ('${id}', '${empresa}', 'Aluguel do galpão', 'f1', 'Imobiliária Centro', 10, 2500.00, 2026, 11, now()${extra ? `, '${extra}'` : ""})`);
const ocorrencia = (id: string, recorrencia: string, ano: number, mes: number) =>
  sql(`INSERT INTO "${T}" ("id", "empresa_id", "numero", "fornecedor", "descricao", "valor_total", "saldo_restante", "recorrencia_id", "ref_ano", "ref_mes", "atualizado_em")
    VALUES ('${id}', 'e1', '${id}', 'Imobiliária Centro', 'Aluguel — ${mes}/${ano}', 2500.00, 2500.00, '${recorrencia}', ${ano}, ${mes}, now())`);

describe.skipIf(!URL)("SQL de produção: contas a pagar recorrentes (PostgreSQL real)", () => {
  let antes = { tabelas: [] as string[], existentes: "", contas: "" };

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    antes = { tabelas: tabelas(), existentes: retrato(tabelas().filter((t) => t !== T)), contas: linhas(T) };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria UMA tabela e mais nada; nenhuma outra tabela ganha, perde ou muda coluna, índice, chave ou linha", () => {
    expect(tabelas()).toEqual([...antes.tabelas, ...NOVAS].sort());
    expect(retrato(antes.tabelas.filter((t) => t !== T))).toBe(antes.existentes);
    expect(sql(`SELECT count(*) FROM "${R}"`)).toBe("0"); // nasce vazia
  });

  it("as contas que já existiam continuam EXATAMENTE como estavam (as colunas novas nascem vazias)", () => {
    // valores e status intactos
    expect(sql(`SELECT string_agg("id" || '|' || "valor_total" || '|' || "valor_pago" || '|' || "status", ',' ORDER BY "id") FROM "${T}"`))
      .toBe("cp1|2500.00|2500.00|PAGO_TOTAL,cp2|320.50|0.00|PENDENTE");
    // as cinco colunas novas: nulas (ou false), em todas as contas antigas
    expect(sql(`SELECT count(*) FROM "${T}" WHERE "recorrencia_id" IS NOT NULL OR "ref_ano" IS NOT NULL OR "ref_mes" IS NOT NULL OR "tecnico_id" IS NOT NULL OR "valor_estimado"`)).toBe("0");
    expect(colunas(SCHEMA, T).split("\n").find((l) => l.startsWith("valor_estimado "))).toBe("valor_estimado boolean bool NO false -,-");
    expect(colunas(SCHEMA, T).split("\n").find((l) => l.startsWith("ref_ano "))).toBe("ref_ano integer int4 YES - 32,0");
  });

  it("a regra guarda o que precisa, com os padrões certos", () => {
    regra("r1");
    expect(sql(`SELECT "situacao" || '|' || "passo_meses" || '|' || "ajuste_dia_nao_util" || '|' || "valor_estimado" || '|' || coalesce("fim_ano"::text, '-') || '|' || coalesce("ocorrencias"::text, '-') FROM "${R}" WHERE "id" = 'r1'`))
      .toBe("ATIVA|1|MANTER|false|-|-");
    expect(colunas(SCHEMA, R).split("\n").find((l) => l.startsWith("valor "))).toBe("valor numeric numeric NO - 12,2");
    // centavos de verdade
    sql(`UPDATE "${R}" SET "valor" = 1234.567 WHERE "id" = 'r1'`);
    expect(sql(`SELECT "valor" FROM "${R}" WHERE "id" = 'r1'`)).toBe("1234.57");
    sql(`UPDATE "${R}" SET "valor" = 2500.00 WHERE "id" = 'r1'`);
  });

  it("uma conta por competência da regra: a segunda é recusada; conta avulsa não é afetada", () => {
    ocorrencia("o1", "r1", 2026, 11);
    expect(() => ocorrencia("o1dup", "r1", 2026, 11)).toThrow(/contas_pagar_recorrencia_id_ref_ano_ref_mes_key/);
    ocorrencia("o2", "r1", 2026, 12); // outra competência, tudo bem
    regra("r2");
    ocorrencia("o3", "r2", 2026, 11); // a mesma competência em OUTRA regra, tudo bem
    // duas contas avulsas (tudo NULL) convivem: no Postgres, NULL não conflita com NULL
    sql(`INSERT INTO "${T}" ("id", "empresa_id", "numero", "fornecedor", "descricao", "valor_total", "saldo_restante", "atualizado_em")
      VALUES ('avulsa1', 'e1', 'CP-9', 'X', 'Avulsa', 10, 10, now()), ('avulsa2', 'e1', 'CP-10', 'X', 'Avulsa', 10, 10, now())`);
    expect(sql(`SELECT count(*) FROM "${T}" WHERE "recorrencia_id" IS NULL`)).toBe("4");
  });

  it("apagar a REGRA não apaga conta nenhuma: a conta fica, sem o vínculo (o histórico é razão)", () => {
    sql(`DELETE FROM "${R}" WHERE "id" = 'r2'`);
    expect(sql(`SELECT "recorrencia_id" IS NULL || '|' || "valor_total" FROM "${T}" WHERE "id" = 'o3'`)).toBe("true|2500.00");
    expect(sql(`SELECT count(*) FROM "${T}"`)).toBe("7"); // cp1, cp2, o1, o2, o3 e as duas avulsas
  });

  it("as chaves estrangeiras existem e apontam para onde devem", () => {
    const fks = chaves(SCHEMA, R);
    expect(fks).toContain('contas_pagar_recorrencias_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE');
    expect(fks).toContain('contas_pagar_recorrencias_fornecedor_id_fkey FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON UPDATE CASCADE ON DELETE SET NULL');
    expect(fks).toContain('contas_pagar_recorrencias_tecnico_id_fkey FOREIGN KEY (tecnico_id) REFERENCES tecnicos(id) ON UPDATE CASCADE ON DELETE SET NULL');
    expect(chaves(SCHEMA, T)).toContain('contas_pagar_recorrencia_id_fkey FOREIGN KEY (recorrencia_id) REFERENCES contas_pagar_recorrencias(id) ON UPDATE CASCADE ON DELETE SET NULL');
    // apagar a empresa leva a regra junto (como todo o resto do sistema)
    sql(`INSERT INTO "${R}" ("id", "empresa_id", "descricao", "favorecido_nome", "dia_vencimento", "valor", "inicio_ano", "inicio_mes", "atualizado_em")
      VALUES ('rE2', 'e2', 'Outra empresa', 'X', 5, 100, 2026, 11, now())`);
    sql(`DELETE FROM "empresas" WHERE "id" = 'e2'`);
    expect(sql(`SELECT count(*) FROM "${R}" WHERE "id" = 'rE2'`)).toBe("0");
  });

  it("é idempotente: roda de novo, com dados gravados, sem erro e sem mudar nada", () => {
    const antesDeRodar = retrato(tabelas());
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    expect(retrato(tabelas())).toBe(antesDeRodar);
  });

  it("dá exatamente o que o Prisma espera (comparado com `prisma db push`)", () => {
    execFileSync("psql", [URL!, "-q", "-c", `CREATE SCHEMA ${PRISMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}` }, stdio: "pipe",
    });
    // a tabela da regra nasce inteira neste SQL: tem de bater coluna por coluna
    expect(colunas(SCHEMA, R), "a regra").toBe(colunas(PRISMA, R).replaceAll(`${PRISMA}.`, ""));

    // "contas_pagar" aqui é a versão reduzida que o teste monta (produção tem mais colunas):
    // comparo só as colunas que ESTA leva acrescenta
    const DESTA_LEVA = /^(recorrencia_id|ref_ano|ref_mes|valor_estimado|tecnico_id) /;
    const minhas = colunas(SCHEMA, T).split("\n").filter((l) => DESTA_LEVA.test(l));
    const doPrisma = colunas(PRISMA, T).split("\n").filter((l) => DESTA_LEVA.test(l));
    expect(minhas, "as colunas novas da conta").toEqual(doPrisma);
    expect(minhas).toHaveLength(5);

    // e os índices das colunas desta leva, nas duas tabelas
    for (const t of [R, T]) {
      const meus = indices(SCHEMA, t).replaceAll(`${SCHEMA}.`, "").split("\n").sort();
      const dele = indices(PRISMA, t).replaceAll(`${PRISMA}.`, "").split("\n").sort();
      for (const i of dele.filter((x) => /recorrencia|ref_ano|tecnico_id|favorecido|situacao/.test(x))) {
        expect(meus, `${t}: ${i}`).toContain(i);
      }
    }
  });
});
