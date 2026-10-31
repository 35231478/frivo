/**
 * Contrato recorrente PR3-A — o SQL de produção rodado de verdade num PostgreSQL, numa transação só, TRÊS
 * vezes, num schema descartável com as tabelas como estão HOJE:
 *  - 1ª rodada: os contratos existentes não-mensais viram MENSAL (decisão do dono, opção b);
 *  - 2ª e 3ª rodadas: NÃO mexem mais na periodicidade (quem foi definido depois fica);
 *  - chaves novas desligadas; referência da nota = CORRENTE;
 *  - execuções: única por contrato × competência, CHECKs, FK (contrato/empresa em cascata, medição SET NULL).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-contrato-faturamento-automatico
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-26_contrato_faturamento_automatico.sql");
const SCHEMA = `teste_ct_fat_auto_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const exec = (id: string, ct: string, ano: number, mes: number, extra = "") =>
  `INSERT INTO faturamento_contrato_execucoes (id, empresa_id, contrato_id, ref_ano, ref_mes, atualizado_em${extra ? ", " + extra.split("=")[0] : ""}) VALUES ('${id}', 'e1', '${ct}', ${ano}, ${mes}, now()${extra ? ", " + extra.split("=")[1] : ""})`;

describe.skipIf(!URL)("SQL de produção: periodicidade + faturamento automático (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TYPE "Periodicidade" AS ENUM ('SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL');
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contratos" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "periodicidade" "Periodicidade" NOT NULL DEFAULT 'MENSAL');
      CREATE TABLE "medicoes" ("id" TEXT PRIMARY KEY);
      INSERT INTO "empresas" VALUES ('e1');
      INSERT INTO "contratos" VALUES ('c1', 'CT-1', 'MENSAL'), ('c2', 'CT-2', 'TRIMESTRAL'), ('c3', 'CT-3', 'SEMANAL'), ('c4', 'CT-4', 'ANUAL');
      INSERT INTO "medicoes" VALUES ('m1'), ('m2');
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("1ª rodada: os existentes viram MENSAL (como já cobravam); chaves novas desligadas; nota = período corrente", () => {
    expect(sql(`SELECT string_agg(numero || '=' || periodicidade, ',' ORDER BY id) FROM contratos`)).toBe("CT-1=MENSAL,CT-2=MENSAL,CT-3=MENSAL,CT-4=MENSAL");
    expect(sql(`SELECT faturamento_automatico || ',' || aprovacao_automatica || ',' || emitir_nfse_auto || ',' || emitir_boleto_auto || ',' || nfse_referencia FROM contratos WHERE id = 'c2'`))
      .toBe("false,false,false,false,CORRENTE");
  });

  it("2ª e 3ª rodadas NÃO voltam a periodicidade definida depois; o resto não duplica", () => {
    sql(`UPDATE contratos SET periodicidade = 'TRIMESTRAL', faturamento_automatico = true WHERE id = 'c2'`);
    rodar();
    rodar();
    expect(sql(`SELECT periodicidade || ',' || faturamento_automatico FROM contratos WHERE id = 'c2'`)).toBe("TRIMESTRAL,true");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'faturamento_contrato_execucoes'`)).toBe("4");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'faturamento_contrato_execucoes'::regclass AND contype = 'f'`)).toBe("3");
  });

  it("execuções: única por contrato × competência; mês 1–12; tentativas ≥ 0; padrões MEDICAO/PENDENTE/0", () => {
    expect(falha(exec("x1", "c1", 2026, 11))).toBe("gravou");
    expect(sql(`SELECT etapa || ',' || situacao || ',' || tentativas FROM faturamento_contrato_execucoes WHERE id = 'x1'`)).toBe("MEDICAO,PENDENTE,0");
    expect(falha(exec("x2", "c1", 2026, 11))).toContain("faturamento_contrato_execucoes_contrato_id_ref_ano_ref_mes_key");
    expect(falha(exec("x3", "c1", 2026, 12))).toBe("gravou");
    expect(falha(exec("x4", "c1", 2026, 13))).toContain("ref_mes_check");
    expect(falha(`UPDATE faturamento_contrato_execucoes SET tentativas = -1 WHERE id = 'x1'`)).toContain("tentativas_check");
    expect(falha(`UPDATE faturamento_contrato_execucoes SET situacao = 'QUALQUER' WHERE id = 'x1'`)).toContain("invalid input value");
  });

  it("FK: contrato inexistente recusado; apagar a medição só solta o vínculo; apagar o contrato leva as execuções", () => {
    expect(falha(exec("y1", "nao-existe", 2026, 1))).toContain("faturamento_contrato_execucoes_contrato_id_fkey");
    sql(`UPDATE faturamento_contrato_execucoes SET medicao_id = 'm1' WHERE id = 'x1'`);
    sql(`DELETE FROM medicoes WHERE id = 'm1'`);
    expect(sql(`SELECT COALESCE(medicao_id, 'null') FROM faturamento_contrato_execucoes WHERE id = 'x1'`)).toBe("null");
    sql(`DELETE FROM contratos WHERE id = 'c1'`);
    expect(sql(`SELECT count(*) FROM faturamento_contrato_execucoes WHERE contrato_id = 'c1'`)).toBe("0");
  });
});
