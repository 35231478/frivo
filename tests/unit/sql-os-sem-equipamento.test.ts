/**
 * OS sem equipamento — o SQL de produção (prisma/sql/2026-10-25_os_sem_equipamento.sql) rodado de
 * verdade num PostgreSQL: schema descartável com "tipos_os" e "ordens_servico" como estão HOJE (sem as
 * colunas, com dados), roda o arquivo DUAS vezes e confere: tipos existentes continuam EXIGINDO
 * equipamento (a trava não afrouxa sozinha), OS sem motivo, e a 2ª rodada não muda nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-os-sem-equipamento
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-25_os_sem_equipamento.sql");
const SCHEMA = `teste_os_sem_equip_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodarArquivo = () => psql(["-f", ARQUIVO]);
const coluna = (tabela: string, nome: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${nome}'`);

describe.skipIf(!URL)("SQL de produção: OS sem equipamento (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "tipos_os" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
      CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "status" TEXT NOT NULL);
      INSERT INTO "tipos_os" VALUES ('t1', 'Manutenção Preventiva', true), ('t2', 'Visita Técnica', true), ('t3', 'Vistoria', false);
      INSERT INTO "ordens_servico" VALUES ('os1', 'ABERTA'), ('os2', 'CONCLUIDA');
    `);
    rodarArquivo();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria tipos_os.exige_equipamento BOOLEAN NOT NULL DEFAULT true e ordens_servico.sem_equipamento_motivo TEXT opcional", () => {
    expect(coluna("tipos_os", "exige_equipamento")).toBe("boolean:NO:true");
    expect(coluna("ordens_servico", "sem_equipamento_motivo")).toBe("text:YES:-");
  });

  it("os tipos que já existem (inclusive Visita/Vistoria) continuam EXIGINDO equipamento — quem desmarca é o dono", () => {
    expect(sql(`SELECT string_agg("id" || '=' || "exige_equipamento", ',' ORDER BY "id") FROM "tipos_os"`)).toBe("t1=true,t2=true,t3=true");
    expect(sql(`SELECT count(*) FROM "ordens_servico" WHERE "sem_equipamento_motivo" IS NOT NULL`)).toBe("0");
  });

  it("rodar de novo não falha nem desfaz o que o dono marcou", () => {
    sql(`UPDATE "tipos_os" SET "exige_equipamento" = false WHERE "id" = 't2'`);
    sql(`UPDATE "ordens_servico" SET "sem_equipamento_motivo" = 'Visita de avaliação' WHERE "id" = 'os1'`);
    rodarArquivo();
    expect(sql(`SELECT string_agg("id" || '=' || "exige_equipamento", ',' ORDER BY "id") FROM "tipos_os"`)).toBe("t1=true,t2=false,t3=true");
    expect(sql(`SELECT "sem_equipamento_motivo" FROM "ordens_servico" WHERE "id" = 'os1'`)).toBe("Visita de avaliação");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND column_name IN ('exige_equipamento', 'sem_equipamento_motivo')`)).toBe("2");
    // tipo novo nasce exigindo
    sql(`INSERT INTO "tipos_os" ("id", "nome") VALUES ('t4', 'Instalação')`);
    expect(sql(`SELECT "exige_equipamento" FROM "tipos_os" WHERE "id" = 't4'`)).toBe("t");
  });
});
