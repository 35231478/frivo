/**
 * Contas a Receber — gestão: o SQL de produção rodado de verdade num PostgreSQL, numa transação só
 * (como o `prisma db execute`), TRÊS vezes, num schema descartável com as tabelas como estão HOJE:
 *  - contas_bancarias nova (nome obrigatório, ativo = true por padrão);
 *  - contas_receber ganha centro de custo, conta bancária, cancelamento e exclusão lógica — tudo nulo,
 *    sem mexer em nenhum dado (o texto `banco` antigo continua);
 *  - FKs: centro/conta bancária apagados viram nulo na conta; eventos somem com a conta; usuário apagado
 *    deixa o evento sem autor;
 *  - 2ª e 3ª rodadas não mudam nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-contas-receber-gestao
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-12_contas_receber_gestao.sql");
const SCHEMA = `teste_cr_gestao_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const coluna = (tabela: string, col: string) =>
  sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${col}'`);

describe.skipIf(!URL)("SQL de produção: gestão de contas a receber (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "centros_custo" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contas_receber" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL, "banco" TEXT, "status" TEXT NOT NULL);
      INSERT INTO "empresas" VALUES ('e1');
      INSERT INTO "usuarios" VALUES ('u1');
      INSERT INTO "centros_custo" VALUES ('cc1');
      INSERT INTO "contas_receber" VALUES ('cr1', 'CR-1', 'Itaú (texto antigo)', 'A_RECEBER'), ('cr2', 'CR-2', NULL, 'RECEBIDO');
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("colunas novas da conta a receber nulas e sem padrão; nenhum dado existente muda", () => {
    for (const col of ["centro_custo_id", "conta_bancaria_id", "motivo_cancelamento"]) expect(coluna("contas_receber", col)).toBe("text:YES:-");
    for (const col of ["cancelada_em", "excluida_em"]) expect(coluna("contas_receber", col)).toBe("timestamp without time zone:YES:-");
    expect(sql(`SELECT string_agg(numero || '|' || COALESCE(banco, '-') || '|' || status || '|' || COALESCE(excluida_em::text, 'viva'), ',' ORDER BY id) FROM contas_receber`))
      .toBe("CR-1|Itaú (texto antigo)|A_RECEBER|viva,CR-2|-|RECEBIDO|viva");
  });

  it("contas_bancarias: nome obrigatório, ativo por padrão; empresa inexistente é recusada", () => {
    expect(coluna("contas_bancarias", "nome")).toBe("text:NO:-");
    expect(coluna("contas_bancarias", "ativo")).toBe("boolean:NO:true");
    expect(falha(`INSERT INTO contas_bancarias (id, empresa_id, nome, atualizado_em) VALUES ('x', 'nao-existe', 'X', now())`)).toContain("contas_bancarias_empresa_id_fkey");
    sql(`INSERT INTO contas_bancarias (id, empresa_id, nome, banco, atualizado_em) VALUES ('cb1', 'e1', 'Inter PJ', 'Banco Inter', now())`);
    expect(sql(`SELECT nome || '|' || ativo FROM contas_bancarias WHERE id = 'cb1'`)).toBe("Inter PJ|true");
  });

  it("FKs: conta bancária/centro inexistentes recusados; apagados viram nulo (a conta a receber fica)", () => {
    expect(falha(`UPDATE contas_receber SET conta_bancaria_id = 'nao' WHERE id = 'cr1'`)).toContain("contas_receber_conta_bancaria_id_fkey");
    expect(falha(`UPDATE contas_receber SET centro_custo_id = 'nao' WHERE id = 'cr1'`)).toContain("contas_receber_centro_custo_id_fkey");
    sql(`UPDATE contas_receber SET conta_bancaria_id = 'cb1', centro_custo_id = 'cc1' WHERE id = 'cr1'`);
    sql(`DELETE FROM contas_bancarias WHERE id = 'cb1'; DELETE FROM centros_custo WHERE id = 'cc1';`);
    expect(sql(`SELECT COALESCE(conta_bancaria_id, 'null') || '|' || COALESCE(centro_custo_id, 'null') FROM contas_receber WHERE id = 'cr1'`)).toBe("null|null");
  });

  it("eventos: conta inexistente recusada; apagar a conta apaga os eventos; apagar o usuário deixa o evento sem autor", () => {
    expect(falha(`INSERT INTO conta_receber_eventos (id, empresa_id, conta_receber_id, tipo) VALUES ('x', 'e1', 'nao', 'EDITADA')`)).toContain("conta_receber_eventos_conta_receber_id_fkey");
    sql(`INSERT INTO conta_receber_eventos (id, empresa_id, conta_receber_id, tipo, usuario_id) VALUES ('ev1', 'e1', 'cr1', 'EDITADA', 'u1'), ('ev2', 'e1', 'cr2', 'RECEBIDA', NULL)`);
    sql(`DELETE FROM usuarios WHERE id = 'u1'`);
    expect(sql(`SELECT COALESCE(usuario_id, 'null') FROM conta_receber_eventos WHERE id = 'ev1'`)).toBe("null");
    sql(`DELETE FROM contas_receber WHERE id = 'cr2'`);
    expect(sql(`SELECT count(*) FROM conta_receber_eventos WHERE id = 'ev2'`)).toBe("0");
  });

  it("2ª e 3ª rodadas não mudam nada (dados ficam; índices e FKs não duplicam)", () => {
    sql(`UPDATE contas_receber SET excluida_em = '2026-11-01', motivo_cancelamento = 'teste' WHERE id = 'cr1'`);
    rodar();
    rodar();
    expect(sql(`SELECT excluida_em::date || '|' || motivo_cancelamento FROM contas_receber WHERE id = 'cr1'`)).toBe("2026-11-01|teste");
    expect(sql(`SELECT count(*) FROM conta_receber_eventos`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace AND contype = 'f'`)).toBe("6");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname IN ('contas_receber_centro_custo_id_idx', 'contas_receber_conta_bancaria_id_idx', 'conta_receber_eventos_conta_receber_id_criado_em_idx', 'conta_receber_eventos_empresa_id_idx', 'contas_bancarias_empresa_id_ativo_idx')`)).toBe("5");
  });
});
