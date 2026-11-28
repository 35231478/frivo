/**
 * HOTFIX push — o SQL de produção (prisma/sql/2027-02-13_push_resultado_por_aparelho.sql) num PostgreSQL descartável,
 * a partir do banco de hoje (sem as colunas novas), com linhas dentro: roda 2×, as linhas que existiam ficam como
 * estavam (falhas 0, o resto nulo), e o resultado é o que o Prisma espera (migrate diff vazio).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-hotfix-push
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-13_push_resultado_por_aparelho.sql");
const SCHEMA = `teste_sql_hotfix_push_${process.pid}`;
const urlDo = (schema: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}`;
const psql = (args: string[]) => execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
  env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
}).trim();
const sql = (q: string) => psql(["-c", q]);

describe.skipIf(!URL)("SQL de produção: resultado do push por aparelho (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) }, stdio: "pipe",
    });
    sql(`ALTER TABLE push_envios DROP COLUMN falhas, DROP COLUMN resultados;
      ALTER TABLE push_subscriptions DROP COLUMN chave_impressao, DROP COLUMN ultimo_status, DROP COLUMN ultimo_erro, DROP COLUMN ultimo_erro_em;
      INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e1', 'Fictícia', '45.723.174/0001-10', 'e@ficticio.test', now());
      INSERT INTO usuarios (id, empresa_id, nome, email, senha, atualizado_em) VALUES ('u1', 'e1', 'Ana', 'ana@ficticio.test', 'x', now());
      INSERT INTO push_subscriptions (id, user_id, empresa_id, endpoint, p256dh, auth) VALUES ('s1', 'u1', 'e1', 'https://push.ficticio/1', 'p', 'a');
      INSERT INTO push_envios (id, empresa_id, usuario_id, tipo, chave, titulo, aparelhos) VALUES ('p1', 'e1', 'u1', 'TESTE', 't1', 'Teste', 0);`);
    psql(["-f", ARQUIVO]);
    sql(`UPDATE push_envios SET falhas = 2 WHERE id = 'p1'`); // gravado entre as rodadas
    psql(["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("as linhas que existiam ficam como estavam; rodar de novo não desfaz o que foi gravado", () => {
    expect(sql(`SELECT falhas || ' ' || coalesce(resultados::text, 'NULO') FROM push_envios WHERE id = 'p1'`)).toBe("2 NULO");
    expect(sql(`SELECT coalesce(chave_impressao, 'NULO') || ' ' || coalesce(ultimo_status::text, 'NULO') FROM push_subscriptions WHERE id = 's1'`)).toBe("NULO NULO");
  });
  it("dá exatamente o que o Prisma espera (migrate diff vazio)", () => {
    const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["migrate", "diff", "--from-url", urlDo(SCHEMA), "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) } });
    expect(diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"))).toEqual([]);
  });
});
