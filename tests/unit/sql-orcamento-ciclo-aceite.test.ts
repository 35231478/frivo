/**
 * Proposta corporativa (parte 2) — o SQL de produção (prisma/sql/2026-10-30_orcamento_ciclo_aceite.sql)
 * rodado de verdade num PostgreSQL: schema descartável com orçamentos como estão HOJE (com dados), roda
 * o arquivo DUAS vezes e confere: colunas novas opcionais, visualizações = 0, respostas que já existiam
 * marcadas como vistas (não acendem o sino), tabela da linha do tempo com FKs, 2ª rodada sem efeito.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-orcamento-ciclo
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-30_orcamento_ciclo_aceite.sql");
const SCHEMA = `teste_orc_ciclo_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodarArquivo = () => psql(["-f", ARQUIVO]);
const coluna = (tabela: string, nome: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${nome}'`);

describe.skipIf(!URL)("SQL de produção: ciclo e aceite do orçamento (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "orcamentos" ("id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "assinado_em" TIMESTAMP(3), "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT now());
      INSERT INTO "empresas" VALUES ('e1');
      INSERT INTO "usuarios" VALUES ('u1');
      INSERT INTO "orcamentos" VALUES
        ('o1', 'ENVIADO', NULL, '2026-10-01'), ('o2', 'APROVADO', '2026-10-02 10:00', '2026-10-03'),
        ('o3', 'REPROVADO', NULL, '2026-10-04'), ('o4', 'RASCUNHO', NULL, '2026-10-05');
    `);
    rodarArquivo();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("colunas novas opcionais; visualizações começam em 0", () => {
    for (const c of ["aprovado_ip", "aprovado_user_agent", "recusado_por", "recusa_motivo", "recusado_ip"]) expect(coluna("orcamentos", c), c).toBe("text:YES:-");
    for (const c of ["recusado_em", "resposta_vista_em"]) expect(coluna("orcamentos", c), c).toMatch(/^timestamp without time zone:YES:-$/);
    expect(coluna("orcamentos", "visualizacoes")).toBe("integer:NO:0");
    expect(sql(`SELECT string_agg(visualizacoes::text, ',' ORDER BY id) FROM orcamentos`)).toBe("0,0,0,0");
  });

  it("respostas que já existiam ficam como vistas (não acendem o sino); as demais não", () => {
    expect(sql(`SELECT string_agg(id || '=' || coalesce(to_char(resposta_vista_em, 'YYYY-MM-DD'), '∅'), ',' ORDER BY id) FROM orcamentos`))
      .toBe("o1=∅,o2=2026-10-02,o3=2026-10-04,o4=∅");
  });

  it("linha do tempo: tabela com FKs (apagar o orçamento apaga os eventos; usuário só solta)", () => {
    sql(`INSERT INTO orcamento_eventos (id, empresa_id, orcamento_id, tipo, usuario_id) VALUES ('ev1', 'e1', 'o1', 'ENVIADO', 'u1')`);
    sql(`DELETE FROM usuarios WHERE id = 'u1'`);
    expect(sql(`SELECT coalesce(usuario_id, '∅') FROM orcamento_eventos`)).toBe("∅");
    sql(`DELETE FROM orcamentos WHERE id = 'o1'`);
    expect(sql(`SELECT count(*) FROM orcamento_eventos`)).toBe("0");
  });

  it("rodar de novo não falha nem mexe no que já foi preenchido", () => {
    sql(`UPDATE orcamentos SET visualizacoes = 3, recusa_motivo = 'Preço' WHERE id = 'o3'`);
    sql(`UPDATE orcamentos SET resposta_vista_em = NULL, status = 'APROVADO' WHERE id = 'o4'`);
    rodarArquivo();
    expect(sql(`SELECT visualizacoes || '|' || recusa_motivo FROM orcamentos WHERE id = 'o3'`)).toBe("3|Preço");
    // o backfill só pega resposta sem "vista" (roda antes do deploy; depois disso quem marca é a tela)
    expect(sql(`SELECT to_char(resposta_vista_em, 'YYYY-MM-DD') FROM orcamentos WHERE id = 'o4'`)).toBe("2026-10-05");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = '${SCHEMA}'::regnamespace`)).toBe("3");
  });
});
