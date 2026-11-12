/**
 * Faturamento — travas C6/C7 e retenções: o SQL de produção rodado de verdade num PostgreSQL, numa
 * transação só (como o `prisma db execute`), TRÊS vezes, num schema descartável com as tabelas de HOJE:
 *  - medicoes ganha as 6 alíquotas de retenção (nulas) e o total retido (0) — nada existente muda;
 *  - (b) uma medição: no máximo UMA conta avulsa viva (de contrato, cancelada e excluída não contam);
 *  - (c) um orçamento: no máximo UMA conta viva;
 *  - banco que JÁ tem duplicata: o índice não nasce, nada é apagado, o script avisa e segue;
 *    resolvida a duplicata, rodar de novo cria o índice;
 *  - 2ª e 3ª rodadas não mudam nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-faturamento-travas
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-14_faturamento_travas_retencoes.sql");
const SCHEMA = `teste_fat_travas_${process.pid}`;
const SCHEMA_DUP = `teste_fat_travas_dup_${process.pid}`;

function psql(schema: string, args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
/** Roda o arquivo e devolve os avisos (stderr) */
function rodar(schema: string) {
  const r = require("node:child_process").spawnSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", ARQUIVO], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return String(r.stderr);
}
const falha = (schema: string, q: string) => { try { psql(schema, ["-c", q]); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const TABELAS = `
  CREATE TYPE "StatusContaReceber" AS ENUM ('PREVISTO', 'A_RECEBER', 'RECEBIDO', 'ATRASADO', 'CANCELADO');
  CREATE TABLE "medicoes" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "valor_liquido" DECIMAL(12,2) NOT NULL DEFAULT 0);
  CREATE TABLE "contas_receber" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "status" "StatusContaReceber" NOT NULL,
    "medicao_id" TEXT, "orcamento_id" TEXT, "contrato_id" TEXT, "excluida_em" TIMESTAMP(3));
  INSERT INTO "medicoes" VALUES ('m1', 'MED-1', 1000), ('m2', 'MED-2', 500);
`;
const indice = (schema: string, nome: string) => psql(schema, ["-c", `SELECT count(*) FROM pg_indexes WHERE schemaname = '${schema}' AND indexname = '${nome}'`]);

describe.skipIf(!URL)("SQL de produção: travas de faturamento e retenções (PostgreSQL real)", () => {
  let avisos1 = "";
  beforeAll(() => {
    for (const s of [SCHEMA, SCHEMA_DUP]) execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s};`]);
    psql(SCHEMA, ["-c", TABELAS + `
      INSERT INTO "contas_receber" VALUES
        ('c1', 'CR-1', 'PREVISTO', 'm1', NULL, NULL, NULL),
        ('c2', 'CT-1/202611', 'PREVISTO', 'm2', NULL, 'ct1', NULL), ('c3', 'CT-2/202611', 'PREVISTO', 'm2', NULL, 'ct2', NULL),
        ('c4', 'CR-4', 'PREVISTO', NULL, 'o1', NULL, NULL), ('c5', 'CR-5', 'CANCELADO', NULL, 'o1', NULL, NULL);
    `]);
    avisos1 = rodar(SCHEMA);
  });
  afterAll(() => {
    if (!process.env.MANTER) for (const s of [SCHEMA, SCHEMA_DUP]) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s} CASCADE;`]);
  });

  it("retenções: 6 alíquotas nulas e total 0 — medições existentes não mudam", () => {
    for (const c of ["ret_iss_aliquota", "ret_ir_aliquota", "ret_pis_aliquota", "ret_cofins_aliquota", "ret_csll_aliquota", "ret_inss_aliquota"]) {
      expect(psql(SCHEMA, ["-c", `SELECT data_type || ':' || numeric_precision || ',' || numeric_scale || ':' || is_nullable FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'medicoes' AND column_name = '${c}'`])).toBe("numeric:5,2:YES");
    }
    expect(psql(SCHEMA, ["-c", `SELECT string_agg(numero || '|' || valor_liquido || '|' || valor_retencoes || '|' || COALESCE(ret_iss_aliquota::text, '-'), ',' ORDER BY id) FROM medicoes`]))
      .toBe("MED-1|1000.00|0.00|-,MED-2|500.00|0.00|-");
    expect(avisos1).not.toContain("NÃO criada");
  });

  it("(b) medição: 2ª conta avulsa viva é recusada; contrato, cancelada e excluída passam", () => {
    expect(indice(SCHEMA, "contas_receber_medicao_avulsa_viva_key")).toBe("1");
    expect(falha(SCHEMA, `INSERT INTO contas_receber VALUES ('x1', 'CR-X', 'A_RECEBER', 'm1', NULL, NULL, NULL)`)).toContain("contas_receber_medicao_avulsa_viva_key");
    expect(falha(SCHEMA, `INSERT INTO contas_receber VALUES ('x2', 'CR-X2', 'CANCELADO', 'm1', NULL, NULL, NULL)`)).toBe("gravou");
    expect(falha(SCHEMA, `INSERT INTO contas_receber VALUES ('x3', 'CR-X3', 'PREVISTO', 'm1', NULL, NULL, now())`)).toBe("gravou");
    expect(falha(SCHEMA, `INSERT INTO contas_receber VALUES ('x4', 'CT-3/202611', 'PREVISTO', 'm1', NULL, 'ct3', NULL)`)).toBe("gravou");
  });

  it("(c) orçamento: 2ª conta viva é recusada; cancelada/excluída passam; outro orçamento passa", () => {
    expect(indice(SCHEMA, "contas_receber_orcamento_viva_key")).toBe("1");
    expect(falha(SCHEMA, `INSERT INTO contas_receber VALUES ('y1', 'CR-Y', 'RECEBIDO', NULL, 'o1', NULL, NULL)`)).toContain("contas_receber_orcamento_viva_key");
    expect(falha(SCHEMA, `INSERT INTO contas_receber VALUES ('y2', 'CR-Y2', 'CANCELADO', NULL, 'o1', NULL, NULL)`)).toBe("gravou");
    expect(falha(SCHEMA, `INSERT INTO contas_receber VALUES ('y3', 'CR-Y3', 'PREVISTO', NULL, 'o1', NULL, now())`)).toBe("gravou");
    expect(falha(SCHEMA, `INSERT INTO contas_receber VALUES ('y4', 'CR-Y4', 'PREVISTO', NULL, 'o2', NULL, NULL)`)).toBe("gravou");
  });

  it("2ª e 3ª rodadas não mudam nada (índices não duplicam, dados ficam)", () => {
    const antes = psql(SCHEMA, ["-c", `SELECT count(*) FROM contas_receber`]);
    rodar(SCHEMA);
    rodar(SCHEMA);
    expect(psql(SCHEMA, ["-c", `SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname LIKE 'contas_receber_%viva_key'`])).toBe("2");
    expect(psql(SCHEMA, ["-c", `SELECT count(*) FROM contas_receber`])).toBe(antes);
  });

  it("banco com duplicata: avisa, NÃO cria o índice e NÃO apaga nada; resolvida, a próxima rodada cria", () => {
    psql(SCHEMA_DUP, ["-c", TABELAS + `
      INSERT INTO "contas_receber" VALUES
        ('d1', 'CR-1', 'PREVISTO', 'm1', NULL, NULL, NULL), ('d2', 'CR-2', 'A_RECEBER', 'm1', NULL, NULL, NULL),
        ('d3', 'CR-3', 'PREVISTO', NULL, 'o1', NULL, NULL), ('d4', 'CR-4', 'PREVISTO', NULL, 'o1', NULL, NULL);
    `]);
    const avisos = rodar(SCHEMA_DUP);
    expect(avisos).toContain("Trava (b) NÃO criada: 1 medição(ões)");
    expect(avisos).toContain("Trava (c) NÃO criada: 1 orçamento(s)");
    expect(indice(SCHEMA_DUP, "contas_receber_medicao_avulsa_viva_key")).toBe("0");
    expect(indice(SCHEMA_DUP, "contas_receber_orcamento_viva_key")).toBe("0");
    expect(psql(SCHEMA_DUP, ["-c", `SELECT string_agg(id || ':' || status, ',' ORDER BY id) FROM contas_receber`])).toBe("d1:PREVISTO,d2:A_RECEBER,d3:PREVISTO,d4:PREVISTO");
    // As retenções entram mesmo assim
    expect(psql(SCHEMA_DUP, ["-c", `SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA_DUP}' AND table_name = 'medicoes' AND column_name LIKE 'ret_%'`])).toBe("6");

    psql(SCHEMA_DUP, ["-c", `UPDATE contas_receber SET status = 'CANCELADO' WHERE id IN ('d2', 'd4')`]);
    expect(rodar(SCHEMA_DUP)).not.toContain("NÃO criada");
    expect(indice(SCHEMA_DUP, "contas_receber_medicao_avulsa_viva_key")).toBe("1");
    expect(indice(SCHEMA_DUP, "contas_receber_orcamento_viva_key")).toBe("1");
  });
});
