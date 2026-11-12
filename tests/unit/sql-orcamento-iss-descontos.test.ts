/**
 * Orçamento: ISS e desconto por grupo — o SQL de produção (prisma/sql/2026-10-27_orcamento_iss_descontos.sql)
 * rodado de verdade num PostgreSQL: schema descartável com "configuracoes" e "orcamentos" como estão HOJE
 * (sem as colunas, com orçamentos já com desconto GERAL em R$ e em %), roda o arquivo DUAS vezes e confere:
 * colunas/defaults, o desconto geral virou desconto dos grupos com a MESMA soma, e a 2ª rodada não muda nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-orcamento-iss
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-27_orcamento_iss_descontos.sql");
const SCHEMA = `teste_orc_iss_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodarArquivo = () => psql(["-f", ARQUIVO]);
const coluna = (tabela: string, nome: string) => sql(`SELECT udt_name || ':' || is_nullable || ':' || coalesce(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${nome}'`);
const descontos = () => sql(`SELECT string_agg("id" || '=' || "desconto_servicos" || '/' || "tipo_desconto_servicos" || '+' || "desconto_produtos" || '/' || "tipo_desconto_produtos", ',' ORDER BY "id") FROM "orcamentos"`);

describe.skipIf(!URL)("SQL de produção: ISS e desconto por grupo no orçamento (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TYPE "TipoDesconto" AS ENUM ('VALOR', 'PERCENTUAL');
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL);
      CREATE TABLE "orcamentos" (
        "id" TEXT PRIMARY KEY,
        "total_servicos" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "total_produtos" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "tipo_desconto" "TipoDesconto" NOT NULL DEFAULT 'VALOR',
        "total_geral" DECIMAL(12,2) NOT NULL DEFAULT 0
      );
      INSERT INTO "configuracoes" VALUES ('c1', 'e1');
      INSERT INTO "orcamentos" VALUES
        ('o1', 1000, 500, 0, 'VALOR', 1500),          -- sem desconto: nada muda
        ('o2', 1000, 500, 100, 'VALOR', 1400),        -- R$ 100 cabe nos serviços
        ('o3', 1000, 500, 1200, 'VALOR', 300),        -- R$ 1.200: 1.000 nos serviços, 200 nos produtos
        ('o4', 1000, 500, 10, 'PERCENTUAL', 1350),    -- 10%: 100 nos serviços, 50 nos produtos
        ('o5', 0, 500, 50, 'VALOR', 450),             -- só produtos
        ('o6', 333.33, 66.67, 7.5, 'PERCENTUAL', 370),-- % com centavos: 30,00 = 25,00 + 5,00
        ('o7', 100, 50, 999, 'VALOR', 0);             -- desconto maior que tudo: limita ao total
    `);
    rodarArquivo();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria as colunas NOT NULL com default zero/VALOR (nada muda até alguém configurar)", () => {
    expect(coluna("configuracoes", "iss_aliquota")).toBe("numeric:NO:0");
    expect(coluna("orcamentos", "desconto_servicos")).toBe("numeric:NO:0");
    expect(coluna("orcamentos", "desconto_produtos")).toBe("numeric:NO:0");
    expect(coluna("orcamentos", "tipo_desconto_servicos")).toBe(`TipoDesconto:NO:'VALOR'::"TipoDesconto"`);
    expect(coluna("orcamentos", "tipo_desconto_produtos")).toBe(`TipoDesconto:NO:'VALOR'::"TipoDesconto"`);
    expect(coluna("orcamentos", "iss_aliquota")).toBe("numeric:NO:0");
    expect(coluna("orcamentos", "valor_iss")).toBe("numeric:NO:0");
    expect(sql(`SELECT numeric_precision || ',' || numeric_scale FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'orcamentos' AND column_name = 'iss_aliquota'`)).toBe("5,2");
    expect(sql(`SELECT "iss_aliquota" FROM "configuracoes"`)).toBe("0.00");
  });

  it("o desconto GERAL antigo vira desconto dos grupos em R$, com a MESMA soma (o total não muda)", () => {
    expect(descontos()).toBe([
      "o1=0.00/VALOR+0.00/VALOR",
      "o2=100.00/VALOR+0.00/VALOR",
      "o3=1000.00/VALOR+200.00/VALOR",
      "o4=100.00/VALOR+50.00/VALOR",
      "o5=0.00/VALOR+50.00/VALOR",
      "o6=25.00/VALOR+5.00/VALOR",
      "o7=100.00/VALOR+50.00/VALOR",
    ].join(","));
    // Subtotal − descontos dos grupos = total geral gravado (o4/o6 em %, o7 limitado)
    expect(sql(`SELECT count(*) FROM "orcamentos" WHERE "total_servicos" + "total_produtos" - "desconto_servicos" - "desconto_produtos" <> "total_geral"`)).toBe("0");
    // ISS dos antigos = 0 (o total não ganha imposto retroativo)
    expect(sql(`SELECT count(*) FROM "orcamentos" WHERE "iss_aliquota" <> 0 OR "valor_iss" <> 0`)).toBe("0");
  });

  it("rodar de novo não falha nem mexe no que já foi repartido ou editado depois", () => {
    const antes = descontos();
    rodarArquivo();
    expect(descontos()).toBe(antes);
    sql(`UPDATE "orcamentos" SET "desconto_servicos" = 15, "tipo_desconto_servicos" = 'PERCENTUAL', "desconto_produtos" = 0 WHERE "id" = 'o2'`);
    sql(`UPDATE "configuracoes" SET "iss_aliquota" = 5 WHERE "id" = 'c1'`);
    rodarArquivo();
    expect(sql(`SELECT "desconto_servicos" || '/' || "tipo_desconto_servicos" FROM "orcamentos" WHERE "id" = 'o2'`)).toBe("15.00/PERCENTUAL");
    expect(sql(`SELECT "iss_aliquota" FROM "configuracoes"`)).toBe("5.00");
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND column_name IN ('iss_aliquota', 'valor_iss', 'desconto_servicos', 'desconto_produtos', 'tipo_desconto_servicos', 'tipo_desconto_produtos')`)).toBe("7");
  });
});
