/**
 * Proposta corporativa (parte 1) — o SQL de produção (prisma/sql/2026-10-29_proposta_corporativa.sql)
 * rodado de verdade num PostgreSQL: schema descartável com as tabelas como estão HOJE (com dados), roda o
 * arquivo DUAS vezes e confere: colunas novas opcionais, padrões de Configurações (validade 10 dias =
 * o que já valia), orçamentos antigos intactos (campos novos vazios), tabela de anexos com FKs, e a
 * 2ª rodada sem efeito.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-proposta-corporativa
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-29_proposta_corporativa.sql");
const SCHEMA = `teste_proposta_corp_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodarArquivo = () => psql(["-f", ARQUIVO]);
const coluna = (tabela: string, nome: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${nome}'`);
const fks = () => sql(`SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE contype = 'f' AND connamespace = '${SCHEMA}'::regnamespace`);

describe.skipIf(!URL)("SQL de produção: proposta corporativa — timbre, padrões, garantias, normas e anexos (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "cnpj" TEXT NOT NULL);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
      CREATE TABLE "unidades" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contatos_cliente" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL);
      CREATE TABLE "orcamentos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "total_geral" DECIMAL(12,2) NOT NULL DEFAULT 0);
      INSERT INTO "empresas" VALUES ('e1', 'Clima Total', '12345678000190');
      INSERT INTO "configuracoes" VALUES ('c1', 'e1');
      INSERT INTO "tecnicos" VALUES ('t1', 'Eng. Ana');
      INSERT INTO "orcamentos" VALUES ('o1', 'Preventiva', 1500), ('o2', 'Corretiva', 380.5);
    `);
    rodarArquivo();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("empresa: IE, IM e RT padrão opcionais", () => {
    for (const c of ["inscricao_estadual", "inscricao_municipal", "responsavel_tecnico_id"]) expect(coluna("empresas", c), c).toBe("text:YES:-");
  });

  it("configurações: padrões do orçamento — validade 10 dias, garantias sugeridas, normas desligadas", () => {
    expect(coluna("configuracoes", "orcamento_validade_dias")).toBe("integer:NO:10");
    expect(sql(`SELECT orcamento_validade_dias || '|' || orcamento_garantia_servico || '|' || orcamento_garantia_pecas || '|' || coalesce(orcamento_nao_incluso, '∅') || '|' || cardinality(orcamento_normas) FROM configuracoes`))
      .toBe("10|90 dias|Conforme garantia do fabricante|∅|0");
  });

  it("orçamentos existentes ficam como estavam: garantias/não incluso/destinatário vazios e nenhuma norma", () => {
    for (const c of ["garantia_servico", "garantia_pecas", "nao_incluso", "unidade_id", "contato_cliente_id"]) expect(coluna("orcamentos", c), c).toBe("text:YES:-");
    expect(coluna("orcamentos", "normas")).toBe("ARRAY:NO:ARRAY[]::text[]");
    expect(sql(`SELECT string_agg(id || '=' || total_geral || '/' || coalesce(garantia_servico, '∅') || '/' || coalesce(nao_incluso, '∅') || '/' || cardinality(normas), ',' ORDER BY id) FROM orcamentos`))
      .toBe("o1=1500.00/∅/∅/0,o2=380.50/∅/∅/0");
  });

  it("tabela de anexos com as chaves estrangeiras (apagar o orçamento apaga os anexos; RT/unidade/contato só soltam)", () => {
    expect(fks()).toBe([
      "empresas_responsavel_tecnico_id_fkey", "orcamento_anexos_criado_por_id_fkey", "orcamento_anexos_empresa_id_fkey",
      "orcamento_anexos_orcamento_id_fkey", "orcamentos_contato_cliente_id_fkey", "orcamentos_unidade_id_fkey",
    ].join(","));
    sql(`INSERT INTO orcamento_anexos (id, empresa_id, orcamento_id, tipo, nome, mime, tamanho, conteudo) VALUES ('a1', 'e1', 'o2', 'ARQUIVO', 'datasheet.pdf', 'application/pdf', 3, 'data:application/pdf;base64,JVBE')`);
    sql(`UPDATE empresas SET responsavel_tecnico_id = 't1'`);
    sql(`DELETE FROM tecnicos WHERE id = 't1'`);
    expect(sql(`SELECT coalesce(responsavel_tecnico_id, '∅') FROM empresas`)).toBe("∅");
    sql(`DELETE FROM orcamentos WHERE id = 'o2'`);
    expect(sql(`SELECT count(*) FROM orcamento_anexos`)).toBe("0");
  });

  it("rodar de novo não falha nem apaga o que foi preenchido", () => {
    sql(`UPDATE orcamentos SET garantia_servico = '6 meses', normas = ARRAY['PMOC'] WHERE id = 'o1'`);
    sql(`UPDATE configuracoes SET orcamento_validade_dias = 15, orcamento_garantia_servico = '120 dias'`);
    sql(`UPDATE empresas SET inscricao_estadual = '123.456.789.110'`);
    rodarArquivo();
    expect(sql(`SELECT garantia_servico || '|' || array_to_string(normas, ',') FROM orcamentos WHERE id = 'o1'`)).toBe("6 meses|PMOC");
    expect(sql(`SELECT orcamento_validade_dias || '|' || orcamento_garantia_servico FROM configuracoes`)).toBe("15|120 dias");
    expect(sql(`SELECT inscricao_estadual FROM empresas`)).toBe("123.456.789.110");
    expect(fks().split(",")).toHaveLength(6);
  });
});
