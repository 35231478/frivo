/**
 * LEVA J — o SQL de produção (prisma/sql/2027-02-13_colaborador_jornada_especialidades.sql) num PostgreSQL
 * descartável, a partir do banco de hoje (sem as colunas novas), com linhas dentro: roda 2×, o colaborador com a
 * jornada antiga fica como estava (as faixas nulas: o sistema lê os campos antigos como uma faixa), a empresa que já
 * existia fica com as especialidades ligadas, e o resultado é o que o Prisma espera (migrate diff vazio).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-leva-j-colaborador
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-13_colaborador_jornada_especialidades.sql");
const SCHEMA = `teste_sql_leva_j_${process.pid}`;
const urlDo = (schema: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}`;
const psql = (args: string[]) => execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
  env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
}).trim();
const sql = (q: string) => psql(["-c", q]);

describe.skipIf(!URL)("SQL de produção: Leva J — jornada em faixas e especialidades (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) }, stdio: "pipe",
    });
    sql(`ALTER TABLE tecnicos DROP COLUMN jornada_faixas;
      ALTER TABLE configuracoes DROP COLUMN mostrar_especialidades_tecnico;
      INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e1', 'Fictícia', '45.723.174/0001-10', 'e@ficticio.test', now());
      INSERT INTO configuracoes (id, empresa_id) VALUES ('cfg1', 'e1');
      INSERT INTO tecnicos (id, empresa_id, nome, cpf, telefone, jornada_entrada, jornada_saida, jornada_dias, atualizado_em)
        VALUES ('t1', 'e1', 'Carlos', '1', '1', '08:00', '18:00', ARRAY['SEG','TER']::text[], now());`);
    psql(["-f", ARQUIVO]);
    sql(`UPDATE configuracoes SET mostrar_especialidades_tecnico = false WHERE id = 'cfg1'; UPDATE tecnicos SET jornada_faixas = '[]' WHERE id = 't1'`); // gravado entre as rodadas
    psql(["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("as linhas que existiam ficam como estavam; rodar de novo não desfaz o que foi gravado", () => {
    expect(sql(`SELECT jornada_entrada || ' ' || jornada_saida || ' ' || array_to_string(jornada_dias, ',') || ' ' || coalesce(jornada_faixas::text, 'NULO') FROM tecnicos WHERE id = 't1'`))
      .toBe("08:00 18:00 SEG,TER []");
    expect(sql(`SELECT mostrar_especialidades_tecnico FROM configuracoes WHERE id = 'cfg1'`)).toBe("f");
  });
  it("a empresa que já existia nasce com as especialidades ligadas (o padrão)", () => {
    sql(`INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e2', 'Outra', '45.723.174/0001-11', 'o@ficticio.test', now());
      INSERT INTO configuracoes (id, empresa_id) VALUES ('cfg2', 'e2');`);
    expect(sql(`SELECT mostrar_especialidades_tecnico FROM configuracoes WHERE id = 'cfg2'`)).toBe("t");
  });
  it("dá exatamente o que o Prisma espera (migrate diff vazio)", () => {
    const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["migrate", "diff", "--from-url", urlDo(SCHEMA), "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) } });
    expect(diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"))).toEqual([]);
  });
});
