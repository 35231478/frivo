/**
 * Central da OS — o SQL de produção (prisma/sql/2026-10-24_os_central_controle.sql) rodado de verdade
 * num PostgreSQL: schema descartável com "ordens_servico" e "atividades_os" como estão HOJE (sem as
 * colunas), roda o arquivo DUAS vezes e confere: prazo da atividade criado; status_manual criado com
 * o BACKFILL certo (só OS "à frente" do automático ficam manuais) e que a 2ª rodada não refaz o backfill.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-os-central
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-24_os_central_controle.sql");
const SCHEMA = `teste_os_central_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodarArquivo = () => psql(["-f", ARQUIVO]);
const manuais = () => sql(`SELECT coalesce(string_agg("id", ',' ORDER BY "id"), '') FROM "ordens_servico" WHERE "status_manual"`);

describe.skipIf(!URL)("SQL de produção: central da OS (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "previsao_conclusao" TIMESTAMP(3));
      CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "ordem_servico_id" TEXT NOT NULL REFERENCES "ordens_servico"("id"),
        "status" TEXT NOT NULL, "data_agendada" TIMESTAMP(3));
      INSERT INTO "ordens_servico" ("id", "status") VALUES
        ('aberta_sem', 'ABERTA'),            -- automático (continua Aberta)
        ('aberta_agend', 'ABERTA'),          -- automático (o sistema vai promover para Agendada)
        ('aguard', 'AGUARDANDO_ATENDIMENTO'),-- automático (= Aberta)
        ('pausada', 'PAUSADA'),              -- manual: exceção que só existe à mão
        ('peca', 'AGUARDANDO_PECA'),         -- manual
        ('agend_ok', 'AGENDADA'),            -- automático: tem atividade com data
        ('agend_sem', 'AGENDADA'),           -- manual: nenhuma atividade com data
        ('andam_ok', 'EM_ANDAMENTO'),        -- automático: atividade em andamento
        ('andam_sem', 'EM_ANDAMENTO'),       -- manual: nada começou
        ('concl_ok', 'CONCLUIDA'),           -- automático: tudo concluído
        ('concl_vazia', 'CONCLUIDA'),        -- manual: concluída sem atividade
        ('concl_aberta', 'CONCLUIDA'),       -- manual: concluída com atividade ainda agendada
        ('cancel', 'CANCELADA');             -- automático (cancelada não é ajuste)
      INSERT INTO "ordens_servico" VALUES
        ('contrato', 'AGENDADA', '2026-11-10'),      -- automático: OS de contrato sem atividade, com data prevista
        ('contrato_ativ', 'AGENDADA', '2026-11-10'); -- manual: tem atividade, mas nenhuma com data
      INSERT INTO "atividades_os" VALUES
        ('a1', 'aberta_agend', 'AGENDADA', '2026-10-30 13:00'),
        ('a2', 'agend_ok', 'AGENDADA', '2026-10-30 13:00'),
        ('a3', 'agend_sem', 'AGENDADA', NULL),
        ('a4', 'andam_ok', 'EM_ANDAMENTO', NULL),
        ('a5', 'andam_sem', 'AGENDADA', '2026-10-30 13:00'),
        ('a6', 'concl_ok', 'CONCLUIDA', NULL), ('a7', 'concl_ok', 'CANCELADA', NULL),
        ('a8', 'concl_vazia', 'CANCELADA', NULL),
        ('a9', 'concl_aberta', 'CONCLUIDA', NULL), ('a10', 'concl_aberta', 'AGENDADA', NULL),
        ('a11', 'contrato_ativ', 'AGENDADA', NULL);
    `);
    rodarArquivo();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria atividades_os.prazo como DATE (sem hora, sem fuso) e opcional", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'atividades_os' AND column_name = 'prazo'`)).toBe("date:YES");
    expect(sql(`SELECT count(*) FROM "atividades_os" WHERE "prazo" IS NOT NULL`)).toBe("0");
  });

  it("cria ordens_servico.status_manual BOOLEAN NOT NULL DEFAULT false", () => {
    expect(sql(`SELECT data_type || ':' || is_nullable || ':' || column_default FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'ordens_servico' AND column_name = 'status_manual'`)).toBe("boolean:NO:false");
  });

  it("backfill: SÓ as OS com status à frente dos fatos ficam em ajuste manual (o automático nunca rebaixa legado)", () => {
    expect(manuais()).toBe("agend_sem,andam_sem,concl_aberta,concl_vazia,contrato_ativ,pausada,peca");
  });

  it("rodar de novo não falha e NÃO refaz o backfill (um ajuste desligado depois continua desligado)", () => {
    sql(`UPDATE "ordens_servico" SET "status_manual" = false WHERE "id" = 'pausada'`);
    sql(`INSERT INTO "ordens_servico" ("id", "status") VALUES ('nova_pausada', 'PAUSADA')`);
    sql(`UPDATE "atividades_os" SET "prazo" = '2026-11-05' WHERE "id" = 'a1'`);
    rodarArquivo();
    expect(manuais()).toBe("agend_sem,andam_sem,concl_aberta,concl_vazia,contrato_ativ,peca");
    expect(sql(`SELECT "prazo" FROM "atividades_os" WHERE "id" = 'a1'`)).toBe("2026-11-05");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND column_name IN ('prazo', 'status_manual')`)).toBe("2");
  });
});
