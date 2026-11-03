/**
 * Numeração de documentos: o SQL de produção (prisma/sql/2026-12-02_numeracao_documentos.sql) rodado
 * de verdade num PostgreSQL, 3 vezes, num schema descartável; depois o Prisma real sobre a tabela que
 * o SQL criou (prova que o model `Numeracao` bate com a tabela).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-numeracao
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-12-02_numeracao_documentos.sql");
const SCHEMA = `teste_numeracao_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const coluna = (col: string) =>
  sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'numeracoes' AND column_name = '${col}'`);

describe.skipIf(!URL)("SQL de produção: numeração de documentos (PostgreSQL real)", () => {
  let prisma: any;
  beforeAll(async () => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY); INSERT INTO "empresas" VALUES ('e1'), ('e2');`);
    rodar();
    process.env.DATABASE_URL = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
  }, 60_000);
  afterAll(async () => { await prisma?.$disconnect(); if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria a tabela: tipo texto, próximo inteiro obrigatório, atualizado_em sem default (o Prisma preenche), FK para a empresa", () => {
    expect(coluna("tipo")).toBe("text:NO:-");
    expect(coluna("proximo")).toBe("integer:NO:-");
    expect(coluna("atualizado_em")).toBe("timestamp without time zone:NO:-");
    expect(falha(`INSERT INTO numeracoes (id, empresa_id, tipo, proximo, atualizado_em) VALUES ('x', 'nao-existe', 'os', 1, now())`)).toContain("numeracoes_empresa_id_fkey");
  });

  it("um contador por empresa e tipo: repetir o tipo na mesma empresa é recusado; em outra empresa entra", () => {
    sql(`INSERT INTO numeracoes (id, empresa_id, tipo, proximo, atualizado_em) VALUES ('n1', 'e1', 'orcamento', 3358, now())`);
    expect(falha(`INSERT INTO numeracoes (id, empresa_id, tipo, proximo, atualizado_em) VALUES ('n2', 'e1', 'orcamento', 1, now())`)).toContain("numeracoes_empresa_id_tipo_key");
    sql(`INSERT INTO numeracoes (id, empresa_id, tipo, proximo, atualizado_em) VALUES ('n3', 'e2', 'orcamento', 1, now())`);
    expect(sql(`SELECT count(*) FROM numeracoes`)).toBe("2");
  });

  it("apagar a empresa apaga os contadores dela (e só dela)", () => {
    sql(`DELETE FROM empresas WHERE id = 'e2'`);
    expect(sql(`SELECT string_agg(id, ',') FROM numeracoes`)).toBe("n1");
  });

  it("2ª e 3ª rodadas não mudam nada: o contador fica, índice e FK não duplicam", () => {
    rodar(); rodar();
    expect(sql(`SELECT proximo FROM numeracoes WHERE id = 'n1'`)).toBe("3358");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace AND conrelid = 'numeracoes'::regclass AND contype = 'f'`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'numeracoes'`)).toBe("2"); // pkey + único
  });

  it("o Prisma real grava e lê pelo model (upsert por empresa+tipo, como o helper faz)", async () => {
    await prisma.numeracao.upsert({ where: { empresaId_tipo: { empresaId: "e1", tipo: "os" } }, create: { empresaId: "e1", tipo: "os", proximo: 500 }, update: { proximo: 0 } });
    await prisma.numeracao.upsert({ where: { empresaId_tipo: { empresaId: "e1", tipo: "os" } }, create: { empresaId: "e1", tipo: "os", proximo: 0 }, update: { proximo: 501 } });
    const n = await prisma.numeracao.findUnique({ where: { empresaId_tipo: { empresaId: "e1", tipo: "os" } } });
    expect(n.proximo).toBe(501);
    expect(n.atualizadoEm).toBeInstanceOf(Date);
    expect(await prisma.numeracao.count({ where: { empresaId: "e1" } })).toBe(2);
  });
});
