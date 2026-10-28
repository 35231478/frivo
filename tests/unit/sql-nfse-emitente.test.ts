/**
 * NFS-e PR1 — o SQL de produção rodado de verdade num PostgreSQL, numa transação só (como o
 * `prisma db execute`), DUAS vezes, num schema descartável com as tabelas como estão HOJE:
 *  - empresa_fiscal: 1 por empresa, ambiente padrão HOMOLOGACAO, CHECKs de regime/ambiente/status/IBGE;
 *  - FKs: apagar a empresa leva os dados fiscais; apagar o usuário só solta o autor;
 *  - permissão nova financeiro.fiscal só nos perfis Administrador/Financeiro que ainda não têm a chave
 *    (quem já tem false continua false; personalizado não ganha);
 *  - 2ª e 3ª rodadas: nada muda, nada duplica.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-nfse-emitente
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-04_nfse_emitente.sql");
const SCHEMA = `teste_nfse_emitente_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
/** O erro do Postgres (stderr do psql) quando o comando falha; "" se passou */
const erro = (q: string) => { try { sql(q); return ""; } catch (e) { return String((e as { stderr?: unknown }).stderr ?? e); } };
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const coluna = (nome: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'empresa_fiscal' AND column_name = '${nome}'`);
const fiscal = (id: string, empresa: string, extra = "") => `INSERT INTO empresa_fiscal (id, empresa_id${extra ? `, ${extra.split("=")[0]}` : ""}) VALUES ('${id}', '${empresa}'${extra ? `, ${extra.split("=")[1]}` : ""})`;
const perm = (id: string) => sql(`SELECT permissoes::text FROM perfis_acesso WHERE id = '${id}'`);

describe.skipIf(!URL)("SQL de produção: NFS-e emitente (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TYPE "TipoPerfilAcesso" AS ENUM ('ADMINISTRADOR', 'SUPERVISOR', 'FINANCEIRO', 'TECNICO', 'AUXILIAR', 'PERSONALIZADO');
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "perfis_acesso" ("id" TEXT PRIMARY KEY, "tipo" "TipoPerfilAcesso" NOT NULL DEFAULT 'PERSONALIZADO', "permissoes" JSONB NOT NULL);
      INSERT INTO "empresas" VALUES ('e1'), ('e2');
      INSERT INTO "usuarios" VALUES ('u1');
      INSERT INTO "perfis_acesso" VALUES
        ('pAdm', 'ADMINISTRADOR', '{"financeiro": {"visualizar": true, "folha": true}}'),
        ('pFin', 'FINANCEIRO', '{"financeiro": {"visualizar": true}}'),
        ('pFinNao', 'FINANCEIRO', '{"financeiro": {"visualizar": true, "fiscal": false}}'),
        ('pPers', 'PERSONALIZADO', '{"financeiro": {"visualizar": true}}'),
        ('pTec', 'TECNICO', '{"ordens": {"visualizar": true}}'),
        ('pAdmSemFin', 'ADMINISTRADOR', '{"ordens": {"visualizar": true}}');
    `);
    rodar();
    rodar(); // 2ª rodada: idempotente
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("colunas: ambiente padrão HOMOLOGACAO, status padrão NAO_CONFIGURADO; certificado só referência (sem arquivo nem senha)", () => {
    expect(coluna("ambiente")).toBe("text:NO:'HOMOLOGACAO'::text");
    expect(coluna("status")).toBe("text:NO:'NAO_CONFIGURADO'::text");
    expect(coluna("incentivo_fiscal")).toBe("boolean:NO:false");
    expect(coluna("codigo_municipio")).toBe("character varying:YES:-");
    expect(coluna("certificado_valido_ate")).toBe("timestamp without time zone:YES:-");
    const nomes = sql(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'empresa_fiscal'`);
    expect(nomes).not.toMatch(/senha|pfx|arquivo|token/);
    sql(fiscal("f1", "e1"));
    expect(sql(`SELECT ambiente || '/' || status || '/' || incentivo_fiscal FROM empresa_fiscal WHERE id = 'f1'`)).toBe("HOMOLOGACAO/NAO_CONFIGURADO/false");
  });

  it("uma por empresa; FK da empresa e do autor", () => {
    expect(erro(fiscal("f2", "e1"))).toMatch(/duplicate key value violates unique constraint "empresa_fiscal_empresa_id_key"/);
    expect(erro(fiscal("f3", "nao-existe"))).toMatch(/empresa_fiscal_empresa_id_fkey/);
    expect(erro(fiscal("f3", "e2", "atualizado_por_id='nao-existe'"))).toMatch(/empresa_fiscal_atualizado_por_id_fkey/);
    sql(fiscal("f3", "e2", "atualizado_por_id='u1'"));
    sql(`DELETE FROM usuarios WHERE id = 'u1'`);
    expect(sql(`SELECT COALESCE(atualizado_por_id, '-') FROM empresa_fiscal WHERE id = 'f3'`)).toBe("-");
    sql(`DELETE FROM empresas WHERE id = 'e2'`);
    expect(sql(`SELECT count(*) FROM empresa_fiscal WHERE id = 'f3'`)).toBe("0");
  });

  it("CHECKs: regime, ambiente, status e código IBGE de 7 dígitos", () => {
    const upd = (set: string) => erro(`UPDATE empresa_fiscal SET ${set} WHERE id = 'f1'`);
    for (const r of ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI"]) expect(upd(`regime_tributario = '${r}'`)).toBe("");
    expect(upd(`regime_tributario = 'SIMPLES'`)).toMatch(/empresa_fiscal_regime_tributario_check/);
    expect(upd(`ambiente = 'PRODUCAO'`)).toBe("");
    expect(upd(`ambiente = 'TESTE'`)).toMatch(/empresa_fiscal_ambiente_check/);
    for (const s of ["PENDENTE", "ATIVO", "ERRO", "NAO_CONFIGURADO"]) expect(upd(`status = '${s}'`)).toBe("");
    expect(upd(`status = 'OK'`)).toMatch(/empresa_fiscal_status_check/);
    expect(upd(`codigo_municipio = '3550308'`)).toBe("");
    expect(upd(`codigo_municipio = '355030'`)).toMatch(/empresa_fiscal_codigo_municipio_check/);
    expect(upd(`codigo_municipio = '35503AB'`)).toMatch(/empresa_fiscal_codigo_municipio_check/);
  });

  it("permissão financeiro.fiscal: Administrador/Financeiro sem a chave ganham; false fica false; os outros não ganham", () => {
    expect(JSON.parse(perm("pAdm"))).toEqual({ financeiro: { visualizar: true, folha: true, fiscal: true } });
    expect(JSON.parse(perm("pFin"))).toEqual({ financeiro: { visualizar: true, fiscal: true } });
    expect(JSON.parse(perm("pFinNao"))).toEqual({ financeiro: { visualizar: true, fiscal: false } });
    expect(JSON.parse(perm("pPers"))).toEqual({ financeiro: { visualizar: true } });
    expect(JSON.parse(perm("pTec"))).toEqual({ ordens: { visualizar: true } });
    expect(JSON.parse(perm("pAdmSemFin"))).toEqual({ ordens: { visualizar: true } });
  });

  it("3ª rodada com dados: nada muda", () => {
    const antes = [sql(`SELECT string_agg(id || '=' || permissoes::text, ';' ORDER BY id) FROM perfis_acesso`), sql(`SELECT count(*) FROM empresa_fiscal`)];
    rodar();
    expect([sql(`SELECT string_agg(id || '=' || permissoes::text, ';' ORDER BY id) FROM perfis_acesso`), sql(`SELECT count(*) FROM empresa_fiscal`)]).toEqual(antes);
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = '${SCHEMA}.empresa_fiscal'::regclass AND contype IN ('f', 'c')`)).toBe("6");
  });
});
