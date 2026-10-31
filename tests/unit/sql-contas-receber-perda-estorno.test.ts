/**
 * Contas a Receber — perda + estorno: o SQL de produção rodado de verdade num PostgreSQL, numa transação
 * só (como o `prisma db execute`), TRÊS vezes, num schema descartável com as tabelas como estão HOJE:
 *  - status novo PERDA no enum (os antigos continuam);
 *  - contas_receber ganha perda_em/motivo/valor/quem (nulos; valor nunca negativo; usuário apagado → nulo);
 *  - recebimentos ganham estornado_em/motivo/quem (nulos; usuário apagado → nulo);
 *  - a permissão Financeiro › Perdas entra só nos perfis Administrador que ainda não têm a chave;
 *  - nenhum dado existente muda; 2ª e 3ª rodadas não mudam nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-contas-receber-perda-estorno
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-20_contas_receber_perda_estorno.sql");
const SCHEMA = `teste_cr_perda_${process.pid}`;

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
const enumStatus = () => sql(`SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'StatusContaReceber' AND n.nspname = '${SCHEMA}'`);
const fotografia = () => enumStatus()
  + "#" + sql(`SELECT string_agg(id || '|' || status || '|' || COALESCE(valor_perda::text, '-') || '|' || COALESCE(perda_por_id, '-'), ',' ORDER BY id) FROM contas_receber`)
  + "#" + sql(`SELECT string_agg(id || '|' || COALESCE(estornado_em::text, '-') || '|' || COALESCE(estornado_por_id, '-'), ',' ORDER BY id) FROM conta_receber_recebimentos`)
  + "#" + sql(`SELECT string_agg(id || '|' || permissoes::text, ',' ORDER BY id) FROM perfis_acesso`)
  + "#" + sql(`SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace`);

describe.skipIf(!URL)("SQL de produção: perda e estorno de contas a receber (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TYPE "StatusContaReceber" AS ENUM ('PREVISTO', 'A_RECEBER', 'RECEBIDO', 'CANCELADO', 'ATRASADO', 'PARCELADO');
      CREATE TYPE "TipoPerfilAcesso" AS ENUM ('ADMINISTRADOR', 'FINANCEIRO', 'PERSONALIZADO');
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contas_receber" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "valor" DECIMAL(12,2) NOT NULL,
        "status" "StatusContaReceber" NOT NULL DEFAULT 'PREVISTO');
      CREATE TABLE "conta_receber_recebimentos" ("id" TEXT PRIMARY KEY, "conta_receber_id" TEXT NOT NULL, "valor" DECIMAL(12,2) NOT NULL);
      CREATE TABLE "perfis_acesso" ("id" TEXT PRIMARY KEY, "tipo" "TipoPerfilAcesso" NOT NULL, "permissoes" JSONB NOT NULL);
      INSERT INTO "usuarios" VALUES ('u1'), ('u2');
      INSERT INTO "contas_receber" VALUES ('cr1', 'e1', 1000, 'ATRASADO'), ('cr2', 'e1', 300, 'RECEBIDO');
      INSERT INTO "conta_receber_recebimentos" VALUES ('r1', 'cr2', 300);
      INSERT INTO "perfis_acesso" VALUES
        ('pAdm', 'ADMINISTRADOR', '{"financeiro":{"visualizar":true,"contasReceber":true}}'),
        ('pAdmNao', 'ADMINISTRADOR', '{"financeiro":{"visualizar":true,"perdas":false}}'),
        ('pFin', 'FINANCEIRO', '{"financeiro":{"visualizar":true,"contasReceber":true}}'),
        ('pSemFin', 'ADMINISTRADOR', '{"ordens":{"visualizar":true}}');
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("enum ganha PERDA (os antigos ficam); colunas novas nulas e sem padrão; nada muda nos dados", () => {
    expect(enumStatus()).toBe("PREVISTO,A_RECEBER,RECEBIDO,CANCELADO,ATRASADO,PARCELADO,PERDA");
    for (const c of ["motivo_perda", "perda_por_id"]) expect(coluna("contas_receber", c)).toBe("text:YES:-");
    expect(coluna("contas_receber", "perda_em")).toBe("timestamp without time zone:YES:-");
    expect(coluna("contas_receber", "valor_perda")).toBe("numeric:YES:-");
    expect(coluna("conta_receber_recebimentos", "estornado_em")).toBe("timestamp without time zone:YES:-");
    for (const c of ["motivo_estorno", "estornado_por_id"]) expect(coluna("conta_receber_recebimentos", c)).toBe("text:YES:-");
    expect(sql(`SELECT string_agg(id || '|' || valor || '|' || status, ',' ORDER BY id) FROM contas_receber`)).toBe("cr1|1000.00|ATRASADO,cr2|300.00|RECEBIDO");
  });

  it("perda: valor negativo recusado; quem marcou inexistente recusado; usuário apagado vira nulo", () => {
    expect(falha(`UPDATE contas_receber SET valor_perda = -1 WHERE id = 'cr1'`)).toContain("contas_receber_valor_perda_check");
    expect(falha(`UPDATE contas_receber SET perda_por_id = 'nao' WHERE id = 'cr1'`)).toContain("contas_receber_perda_por_id_fkey");
    sql(`UPDATE contas_receber SET perda_em = now(), valor_perda = 1000, motivo_perda = 'Falência', perda_por_id = 'u1' WHERE id = 'cr1'`);
    sql(`DELETE FROM usuarios WHERE id = 'u1'`);
    expect(sql(`SELECT COALESCE(perda_por_id, 'null') || '|' || valor_perda FROM contas_receber WHERE id = 'cr1'`)).toBe("null|1000.00");
  });

  it("estorno: quem estornou inexistente recusado; usuário apagado vira nulo (o estorno fica)", () => {
    expect(falha(`UPDATE conta_receber_recebimentos SET estornado_por_id = 'nao' WHERE id = 'r1'`)).toContain("conta_receber_recebimentos_estornado_por_id_fkey");
    sql(`UPDATE conta_receber_recebimentos SET estornado_em = now(), motivo_estorno = 'Baixa em duplicidade', estornado_por_id = 'u2' WHERE id = 'r1'`);
    sql(`DELETE FROM usuarios WHERE id = 'u2'`);
    expect(sql(`SELECT COALESCE(estornado_por_id, 'null') || '|' || motivo_estorno FROM conta_receber_recebimentos WHERE id = 'r1'`)).toBe("null|Baixa em duplicidade");
  });

  it("permissão Perdas: só no Administrador sem a chave (quem tem false fica false; Financeiro não ganha; sem módulo financeiro não ganha)", () => {
    expect(sql(`SELECT permissoes -> 'financeiro' ->> 'perdas' FROM perfis_acesso WHERE id = 'pAdm'`)).toBe("true");
    expect(sql(`SELECT permissoes -> 'financeiro' ->> 'contasReceber' FROM perfis_acesso WHERE id = 'pAdm'`)).toBe("true");
    expect(sql(`SELECT permissoes -> 'financeiro' ->> 'perdas' FROM perfis_acesso WHERE id = 'pAdmNao'`)).toBe("false");
    expect(sql(`SELECT COALESCE(permissoes -> 'financeiro' ->> 'perdas', 'ausente') FROM perfis_acesso WHERE id = 'pFin'`)).toBe("ausente");
    expect(sql(`SELECT permissoes::text FROM perfis_acesso WHERE id = 'pSemFin'`)).toBe('{"ordens": {"visualizar": true}}');
  });

  it("idempotente: a 2ª e a 3ª rodadas (com dados novos no meio) não mudam nada", () => {
    const antes = fotografia();
    rodar();
    rodar();
    expect(fotografia()).toBe(antes);
  });
});
