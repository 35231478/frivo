/**
 * Contrato recorrente PR4 — o SQL de produção do reajuste anual rodado de verdade num PostgreSQL, numa
 * transação só, TRÊS vezes, num schema descartável com as tabelas como estão HOJE:
 *  - linhas antigas do histórico ficam como estão (APLICADO, sem ano) e não travam nada;
 *  - uma decisão por contrato × ano de aniversário (índice único); mês 1–12; quem aplicou com SET NULL;
 *  - contratos.reajuste_adiado_ate (data) nasce vazio; nenhum valor de contrato muda.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-contrato-reajuste-anual
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-28_contrato_reajuste_anual.sql");
const SCHEMA = `teste_ct_reajuste_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const reajuste = (id: string, ct: string, extra: Record<string, string> = {}) => {
  const cols = ["id", "empresa_id", "contrato_id", "indice", "percentual", "valor_anterior", "valor_novo", ...Object.keys(extra)];
  const vals = [`'${id}'`, "'e1'", `'${ct}'`, "'PERCENTUAL_FIXO'", "5", "1000", "1050", ...Object.values(extra)];
  return `INSERT INTO reajustes_contrato (${cols.join(", ")}) VALUES (${vals.join(", ")})`;
};

describe.skipIf(!URL)("SQL de produção: reajuste anual sugerido e confirmado (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contratos" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "valor_mensal" DECIMAL(10,2));
      CREATE TABLE "reajustes_contrato" (
        "id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "contrato_id" TEXT NOT NULL REFERENCES "contratos" ("id") ON DELETE CASCADE,
        "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "indice" TEXT NOT NULL, "percentual" DECIMAL(6,3) NOT NULL,
        "valor_anterior" DECIMAL(10,2) NOT NULL, "valor_novo" DECIMAL(10,2) NOT NULL, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO "usuarios" VALUES ('u1'), ('u2');
      INSERT INTO "contratos" VALUES ('c1', 'CT-1', 1000), ('c2', 'CT-2', 2500.50);
    `);
    sql(reajuste("antigo1", "c1"));
    sql(reajuste("antigo2", "c1"));
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("1ª rodada: o histórico antigo fica (APLICADO, sem ano) e os contratos não mudam de valor", () => {
    expect(sql(`SELECT string_agg(id || '|' || situacao || '|' || coalesce(ano_referencia::text, '-') || '|' || coalesce(usuario_id, '-'), ',' ORDER BY id) FROM reajustes_contrato`))
      .toBe("antigo1|APLICADO|-|-,antigo2|APLICADO|-|-");
    expect(sql(`SELECT string_agg(id || '=' || valor_mensal || '/' || coalesce(reajuste_adiado_ate::text, '-'), ',' ORDER BY id) FROM contratos`)).toBe("c1=1000.00/-,c2=2500.50/-");
    expect(sql(`SELECT data_type FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'contratos' AND column_name = 'reajuste_adiado_ate'`)).toBe("date");
  });

  it("uma decisão por contrato × ano: o 2º reajuste do mesmo aniversário é recusado; outro ano ou outro contrato passa", () => {
    expect(falha(reajuste("r2027", "c1", { ano_referencia: "2027", mes_referencia: "3", usuario_id: "'u1'" }))).toBe("gravou");
    expect(falha(reajuste("r2027b", "c1", { ano_referencia: "2027", mes_referencia: "3", situacao: "'DISPENSADO'" }))).toMatch(/reajustes_contrato_contrato_id_ano_referencia_key/);
    expect(falha(reajuste("r2028", "c1", { ano_referencia: "2028", mes_referencia: "3", situacao: "'DISPENSADO'", motivo: "'cliente pediu'" }))).toBe("gravou");
    expect(falha(reajuste("c2r2027", "c2", { ano_referencia: "2027", mes_referencia: "7" }))).toBe("gravou");
  });

  it("regras: mês 1–12, situação só APLICADO/DISPENSADO, usuário de verdade (apagar o usuário não apaga o histórico)", () => {
    expect(falha(reajuste("mes13", "c2", { ano_referencia: "2029", mes_referencia: "13" }))).toMatch(/reajustes_contrato_mes_referencia_check/);
    expect(falha(reajuste("sit", "c2", { ano_referencia: "2030", situacao: "'ADIADO'" }))).toMatch(/invalid input value for enum/);
    expect(falha(reajuste("fantasma", "c2", { ano_referencia: "2031", usuario_id: "'ninguem'" }))).toMatch(/reajustes_contrato_usuario_id_fkey/);
    sql(`DELETE FROM usuarios WHERE id = 'u1'`);
    expect(sql(`SELECT coalesce(usuario_id, 'nulo') FROM reajustes_contrato WHERE id = 'r2027'`)).toBe("nulo");
  });

  it("2ª e 3ª rodadas: sem erro e sem mudar nada (nem os dados, nem índice/regra a mais)", () => {
    const antes = sql(`SELECT string_agg(id || '|' || situacao || '|' || coalesce(ano_referencia::text, '-') || '|' || coalesce(motivo, '-'), ',' ORDER BY id) FROM reajustes_contrato`);
    sql(`UPDATE contratos SET reajuste_adiado_ate = '2027-04-10' WHERE id = 'c2'`);
    rodar();
    rodar();
    expect(sql(`SELECT string_agg(id || '|' || situacao || '|' || coalesce(ano_referencia::text, '-') || '|' || coalesce(motivo, '-'), ',' ORDER BY id) FROM reajustes_contrato`)).toBe(antes);
    expect(sql(`SELECT reajuste_adiado_ate FROM contratos WHERE id = 'c2'`)).toBe("2027-04-10");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'reajustes_contrato'`)).toBe("3");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'reajustes_contrato'::regclass AND contype IN ('c', 'f')`)).toBe("3");
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'SituacaoReajuste' AND n.nspname = '${SCHEMA}'`)).toBe("1");
  });
});
