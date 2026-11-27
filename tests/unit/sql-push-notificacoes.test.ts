/**
 * Push — o SQL de produção (prisma/sql/2027-02-05_push_notificacoes.sql) rodado de verdade num PostgreSQL, DUAS
 * vezes: num banco com a "push_subscriptions" como está hoje (com uma inscrição antiga) e num banco sem ela.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-push-notificacoes
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2027-02-05_push_notificacoes.sql");
const COM = `teste_sql_push_${process.pid}`;
const SEM = `teste_sql_push_vazio_${process.pid}`;

function psql(schema: string, args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

describe.skipIf(!URL)("SQL de produção: notificações push (PostgreSQL real)", () => {
  const sql = (q: string, schema = COM) => psql(schema, ["-c", q]);
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${COM} CASCADE; CREATE SCHEMA ${COM}; DROP SCHEMA IF EXISTS ${SEM} CASCADE; CREATE SCHEMA ${SEM};`]);
    for (const s of [COM, SEM]) sql(`CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY); CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL);
      INSERT INTO "empresas" VALUES ('e1'), ('e2'); INSERT INTO "usuarios" VALUES ('u1', 'e1'), ('u2', 'e2');`, s);
    // como está hoje em produção: a tabela antiga, com uma inscrição
    sql(`CREATE TABLE "push_subscriptions" ("id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
      "user_agent" TEXT, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"));
      CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" ("endpoint");
      ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      INSERT INTO "push_subscriptions" ("id", "user_id", "endpoint", "p256dh", "auth") VALUES ('s-antiga', 'u1', 'https://push.exemplo/antiga', 'p', 'a');`);
    for (const s of [COM, COM, SEM, SEM]) psql(s, ["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${COM} CASCADE; DROP SCHEMA IF EXISTS ${SEM} CASCADE;`]); });

  const colunas = (tabela: string, schema = COM) => sql(`SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-'), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}'`, schema).split(",");

  it("push_subscriptions: as três colunas novas no fim; a inscrição antiga fica igual (sem empresa, 0 falhas)", () => {
    expect(colunas("push_subscriptions").slice(-3)).toEqual(["empresa_id:text:YES:-", "ultimo_envio_em:timestamp without time zone:YES:-", "falhas:integer:NO:0"]);
    expect(colunas("push_subscriptions")).toHaveLength(10);
    expect(sql(`SELECT "id" || '|' || "endpoint" || '|' || COALESCE("empresa_id", 'NULL') || '|' || "falhas" FROM "push_subscriptions"`)).toBe("s-antiga|https://push.exemplo/antiga|NULL|0");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${COM}' AND indexname = 'push_subscriptions_user_id_idx'`)).toBe("1");
  });

  it("push_envios: a tabela, a chave única (usuário, chave) e o apagar em cascata", () => {
    expect(colunas("push_envios").map((c) => c.split(":")[0])).toEqual(["id", "empresa_id", "usuario_id", "tipo", "chave", "titulo", "url", "aparelhos", "criado_em"]);
    sql(`INSERT INTO "push_envios" ("id", "empresa_id", "usuario_id", "tipo", "chave", "titulo") VALUES ('n1', 'e1', 'u1', 'OS_NOVA', 'os-nova:a1', 'Nova OS')`);
    expect(() => sql(`INSERT INTO "push_envios" ("id", "empresa_id", "usuario_id", "tipo", "chave", "titulo") VALUES ('n2', 'e1', 'u1', 'OS_NOVA', 'os-nova:a1', 'Nova OS')`)).toThrow(/push_envios_usuario_id_chave_key/);
    sql(`INSERT INTO "push_envios" ("id", "empresa_id", "usuario_id", "tipo", "chave", "titulo") VALUES ('n3', 'e2', 'u2', 'OS_NOVA', 'os-nova:a1', 'Nova OS')`); // outra pessoa, mesma chave: pode
    expect(sql(`SELECT "aparelhos" FROM "push_envios" WHERE "id" = 'n1'`)).toBe("0");
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u2'`);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "push_envios"`)).toBe("n1");
    sql(`DELETE FROM "empresas" WHERE "id" = 'e1'`);
    expect(sql(`SELECT count(*) FROM "push_envios"`)).toBe("0");
  });

  it("num banco sem a tabela antiga, cria tudo (2x, sem erro)", () => {
    expect(colunas("push_subscriptions", SEM).map((c) => c.split(":")[0])).toEqual(["id", "user_id", "endpoint", "p256dh", "auth", "user_agent", "criado_em", "empresa_id", "ultimo_envio_em", "falhas"]);
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE connamespace = '${SEM}'::regnamespace AND contype = 'f'`, SEM)).toBe("3");
  });
});
