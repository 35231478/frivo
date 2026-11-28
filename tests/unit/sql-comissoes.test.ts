/**
 * COM-1 — o SQL de produção (prisma/sql/2027-02-11_comissoes.sql) rodado de verdade num PostgreSQL descartável,
 * POR CIMA do banco como está em produção hoje (o schema inteiro do Prisma SEM o que a COM-1 acrescenta):
 *  - só acrescenta (nenhum DROP, nenhum DELETE; o único UPDATE é o backfill da coluna nova);
 *  - backfill: orcamentos.vendedor_id = criado_por_id, só onde está vazio; nada mais muda nos orçamentos;
 *  - as configurações existentes ganham os padrões ("No recebimento", base com impostos);
 *  - as travas (CHECK) recusam valores fora do modelo;
 *  - é idempotente (roda três vezes sem erro e sem mudar nada — nem o vendedor já trocado);
 *  - dá EXATAMENTE o que o Prisma espera (colunas, índices e chaves iguais aos do `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-comissoes
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 120_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-11_comissoes.sql");
/** A COM-2 vem por cima (o catálogo final é o do schema.prisma de hoje) */
const ARQUIVO_COM2 = path.join(RAIZ, "prisma/sql/2027-02-14_comissao_executor.sql");
const SCHEMA = `teste_comissoes_${process.pid}`;
const ESPERADO = `teste_comissoes_prisma_${process.pid}`;
const PRISMA_BIN = path.join(RAIZ, "node_modules/.bin/prisma");

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const urlDoSchema = (schema = SCHEMA) => { const u = new globalThis.URL(URL!); u.searchParams.set("schema", schema); return u.toString(); };

/** Desfaz o que a COM-1 acrescenta (e a COM-2, que vem por cima): o banco fica como a produção estava antes da COM-1 */
const REBOBINAR = `
  DROP TABLE "comissao_revisoes"; DROP TABLE "comissao_tetos";
  ALTER TABLE "configuracoes" DROP COLUMN "comissao_executor_quando", DROP COLUMN "comissao_retorno_dias";
  DROP TABLE "comissao_lancamentos"; DROP TABLE "comissoes"; DROP TABLE "comissao_regras";
  ALTER TABLE "orcamentos" DROP COLUMN "vendedor_id"; ALTER TABLE "ordens_servico" DROP COLUMN "vendedor_id"; ALTER TABLE "medicoes" DROP COLUMN "vendedor_id";
  ALTER TABLE "servicos" DROP COLUMN "categoria";
  ALTER TABLE "configuracoes" DROP COLUMN "comissao_quando", DROP COLUMN "comissao_liquida_impostos";
  ALTER TABLE "desempenho_fechamentos" DROP COLUMN "total_comissao";
  ALTER TABLE "desempenho_fechamento_linhas" DROP COLUMN "usuario_id", DROP COLUMN "comissao", DROP COLUMN "conta_pagar_id";
`;

/** Insere uma linha preenchendo as colunas obrigatórias sem padrão (as FKs ficam desligadas só neste INSERT) */
function inserir(tabela: string, valores: Record<string, string | null>) {
  const obrig = sql(`SELECT column_name || '|' || data_type || '|' || udt_name FROM information_schema.columns
    WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND is_nullable = 'NO' AND column_default IS NULL`).split("\n").filter(Boolean);
  const cols: Record<string, string> = {};
  for (const l of obrig) {
    const [c, tipo, udt] = l.split("|");
    cols[c] = tipo === "USER-DEFINED" ? `(enum_range(NULL::"${udt}"))[1]` : /timestamp|date/.test(tipo) ? "now()" : tipo === "boolean" ? "false"
      : /numeric|integer|double|bigint|real/.test(tipo) ? "0" : /json/.test(tipo) ? "'{}'" : tipo === "ARRAY" ? "'{}'" : `'${c}-${valores.id}'`;
  }
  for (const [c, v] of Object.entries(valores)) cols[c] = v === null ? "NULL" : `'${v}'`;
  const nomes = Object.keys(cols);
  sql(`SET session_replication_role = replica; INSERT INTO "${tabela}" (${nomes.map((n) => `"${n}"`).join(", ")}) VALUES (${nomes.map((n) => cols[n]).join(", ")});`);
}

describe.skipIf(!URL)("SQL de produção: COM-1 — comissões do vendedor (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${ESPERADO} CASCADE;`], { stdio: "pipe" });
    execFileSync(PRISMA_BIN, ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDoSchema() }, stdio: "pipe" });
    sql(REBOBINAR);
    // Produção em uso: duas empresas, orçamentos com e sem autor, uma configuração gravada
    inserir("usuarios", { id: "u1", email: "u1@ficticio.test" });
    inserir("usuarios", { id: "u2", email: "u2@ficticio.test" });
    inserir("orcamentos", { id: "o1", empresa_id: "e1", criado_por_id: "u1", codigo: "ORC-1" });
    inserir("orcamentos", { id: "o2", empresa_id: "e1", criado_por_id: "u2", codigo: "ORC-2" });
    inserir("orcamentos", { id: "o3", empresa_id: "e2", criado_por_id: "u1", codigo: "ORC-3" }); // outra empresa
    inserir("configuracoes", { id: "c1", empresa_id: "e1" });
    psql(["-f", ARQUIVO]);
  }, 180_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${ESPERADO} CASCADE;`], { stdio: "pipe" });
  });

  it("só acrescenta: nenhum DROP, nenhum DELETE, nenhum TRUNCATE; o único UPDATE é o backfill de vendedor_id", () => {
    const texto = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(texto.replace(/ON (DELETE|UPDATE) (SET NULL|CASCADE)/g, "")).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
    expect(texto.match(/\bUPDATE\s+"/gi)).toEqual(['UPDATE "']);
    expect(texto).toMatch(/UPDATE "orcamentos" SET "vendedor_id" = "criado_por_id" WHERE "vendedor_id" IS NULL;/);
  });

  it("backfill: o vendedor nasce = quem criou (em todas as empresas); configuração existente ganha os padrões", () => {
    expect(sql(`SELECT string_agg("id" || ':' || coalesce("vendedor_id", '-'), ',' ORDER BY "id") FROM "orcamentos"`)).toBe("o1:u1,o2:u2,o3:u1");
    expect(sql(`SELECT "comissao_quando" || '|' || "comissao_liquida_impostos" FROM "configuracoes" WHERE "id" = 'c1'`)).toBe("RECEBIMENTO|false");
  });

  it("as travas recusam o que está fora do modelo (papel, base, valor negativo, gatilho da empresa)", () => {
    const regra = (extra: Record<string, string>) => sql(`INSERT INTO "comissao_regras" ("id", "empresa_id", "quem_tipo", "papel", "sobre_tipo", "base", "valor", "atualizado_em")
      VALUES ('${extra.id}', 'e1', '${extra.quem ?? "TODOS"}', '${extra.papel ?? "VENDEDOR"}', '${extra.sobre ?? "TODOS_SERVICOS"}', '${extra.base ?? "PERC_VENDA"}', ${extra.valor ?? "5"}, now())`);
    sql(`SET session_replication_role = replica;`);
    expect(() => regra({ id: "x1", papel: "GERENTE" })).toThrow(/check/i);
    expect(() => regra({ id: "x2", base: "PERC_QUALQUER" })).toThrow(/check/i);
    expect(() => regra({ id: "x3", valor: "-1" })).toThrow(/check/i);
    expect(() => sql(`UPDATE "configuracoes" SET "comissao_quando" = 'QUANDO_DER' WHERE "id" = 'c1'`)).toThrow(/check/i);
  });

  it("é IDEMPOTENTE: roda de novo (três vezes) sem erro e sem desfazer um vendedor já trocado", () => {
    sql(`UPDATE "orcamentos" SET "vendedor_id" = 'u2' WHERE "id" = 'o1'`); // trocado depois, na tela
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO]);
    expect(sql(`SELECT string_agg("id" || ':' || coalesce("vendedor_id", '-'), ',' ORDER BY "id") FROM "orcamentos"`)).toBe("o1:u2,o2:u2,o3:u1");
    const fks = sql(`SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${SCHEMA}' AND conname LIKE '%vendedor_id_fkey'`);
    expect(fks).toBe("3"); // uma por tabela, nenhuma em dobro
  });

  it("dá EXATAMENTE o que o Prisma espera (o catálogo inteiro igual ao do `prisma db push` do schema.prisma)", () => {
    psql(["-f", ARQUIVO_COM2]);
    execFileSync(PRISMA_BIN, ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDoSchema(ESPERADO) }, stdio: "pipe" });
    const catalogo = (schema: string) => [
      sql(`SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(numeric_precision::text, '-') || ',' || coalesce(numeric_scale::text, '-')
        FROM information_schema.columns WHERE table_schema = '${schema}' ORDER BY table_name, column_name`),
      sql(`SELECT indexdef FROM pg_indexes WHERE schemaname = '${schema}' ORDER BY indexname`),
      sql(`SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = '${schema}' AND contype IN ('p', 'u', 'f') ORDER BY conrelid::regclass::text, conname`),
    ].join("\n=====\n").replaceAll(`${schema}.`, "").replaceAll(`"${schema}".`, "");
    const real = catalogo(SCHEMA).split("\n"), esperado = catalogo(ESPERADO).split("\n");
    expect(real.filter((l) => !esperado.includes(l)), "sobra no SQL").toEqual([]);
    expect(esperado.filter((l) => !real.includes(l)), "falta no SQL").toEqual([]);
  });
});
