/**
 * Compras — Pedido de Compra completo: os 2 SQLs de produção rodados de verdade num PostgreSQL, cada um
 * numa transação só (como o `prisma db execute`) e em execuções separadas (o enum precisa existir antes
 * de ser usado). Schema descartável com pedidos/perfis como estão HOJE; roda os 2 arquivos DUAS vezes:
 *  - enum ganha PARCIAL e CONCLUIDO sem perder os valores antigos;
 *  - pedidos antigos: Entregue → Concluída, Comprado → Em cotação, link público próprio, data do status;
 *  - histórico com FKs; fornecedor solta ao apagar;
 *  - permissão "compras" para quem via pelo Financeiro (e "criar" antigo vira "gerenciar"); 2ª rodada sem efeito.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-compras-pedido
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ENUM = path.resolve(__dirname, "../../prisma/sql/2026-10-31_compras_pedido_1_enum.sql");
const DADOS = path.resolve(__dirname, "../../prisma/sql/2026-10-31_compras_pedido_2.sql");
const SCHEMA = `teste_compras_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
/** Como o `prisma db execute`: o arquivo inteiro numa transação */
const rodar = (arquivo: string) => psql(["--single-transaction", "-f", arquivo]);
const coluna = (tabela: string, nome: string) => sql(`SELECT data_type || ':' || is_nullable FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${nome}'`);

describe.skipIf(!URL)("SQL de produção: Pedido de Compra completo (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TYPE "StatusPedidoCompra" AS ENUM ('SOLICITADO', 'COTANDO', 'COMPRADO', 'ENTREGUE', 'CANCELADO');
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "fornecedores" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "perfis_acesso" ("id" TEXT PRIMARY KEY, "permissoes" JSONB NOT NULL);
      CREATE TABLE "pedidos_compra_interno" (
        "id" TEXT PRIMARY KEY, "status" "StatusPedidoCompra" NOT NULL DEFAULT 'SOLICITADO',
        "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT now()
      );
      INSERT INTO "empresas" VALUES ('e1');
      INSERT INTO "usuarios" VALUES ('u1');
      INSERT INTO "fornecedores" VALUES ('f1');
      INSERT INTO "pedidos_compra_interno" VALUES
        ('p1', 'SOLICITADO', '2026-10-01'), ('p2', 'COMPRADO', '2026-10-02'), ('p3', 'ENTREGUE', '2026-10-03'), ('p4', 'CANCELADO', '2026-10-04');
      INSERT INTO "perfis_acesso" VALUES
        ('fin', '{"financeiro": {"visualizar": true}}'),
        ('tec', '{"ordens": {"visualizar": true}, "financeiro": {"visualizar": false}}'),
        ('antigo', '{"compras": {"visualizar": true, "criar": true}}'),
        ('soVer', '{"compras": {"visualizar": true}, "financeiro": {"visualizar": true}}'),
        ('vazio', '{}');
    `);
    rodar(ENUM);
    rodar(DADOS);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("enum: PARCIAL e CONCLUIDO no fim, sem perder os valores antigos", () => {
    expect(sql(`SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'StatusPedidoCompra' AND t.typnamespace = '${SCHEMA}'::regnamespace`))
      .toBe("SOLICITADO,COTANDO,COMPRADO,ENTREGUE,CANCELADO,PARCIAL,CONCLUIDO");
  });

  it("status legados viram o ciclo novo: Entregue → Concluída; Comprado → Em cotação; os outros ficam", () => {
    expect(sql(`SELECT string_agg(id || '=' || status, ',' ORDER BY id) FROM pedidos_compra_interno`)).toBe("p1=SOLICITADO,p2=COTANDO,p3=CONCLUIDO,p4=CANCELADO");
  });

  it("colunas novas: data do status, fornecedor e motivo opcionais, link público único em todos", () => {
    expect(coluna("pedidos_compra_interno", "status_em")).toBe("timestamp without time zone:NO");
    for (const c of ["fornecedor_id", "motivo"]) expect(coluna("pedidos_compra_interno", c), c).toBe("text:YES");
    expect(coluna("pedidos_compra_interno", "token_publico")).toBe("text:NO");
    expect(sql(`SELECT count(DISTINCT token_publico) || '/' || count(*) FROM pedidos_compra_interno`)).toBe("4/4");
    expect(sql(`SELECT to_char(status_em, 'YYYY-MM-DD') FROM pedidos_compra_interno WHERE id = 'p3'`)).toBe("2026-10-03");
    expect(() => sql(`UPDATE pedidos_compra_interno SET token_publico = (SELECT token_publico FROM pedidos_compra_interno WHERE id = 'p1') WHERE id = 'p2'`)).toThrow(/unique|duplicate/i);
  });

  it("Compras para quem via pelo Financeiro; 'criar' antigo vira 'gerenciar'; quem não tinha, não ganha", () => {
    const perm = (id: string) => sql(`SELECT coalesce(permissoes -> 'compras', 'null'::jsonb)::text FROM perfis_acesso WHERE id = '${id}'`);
    expect(JSON.parse(perm("fin"))).toEqual({ visualizar: true, gerenciar: true });
    expect(JSON.parse(perm("antigo"))).toEqual({ visualizar: true, criar: true, gerenciar: true });
    expect(JSON.parse(perm("soVer"))).toEqual({ visualizar: true }); // já tinha a chave: não ganha gerenciar sozinho
    expect(perm("tec")).toBe("null");
    expect(perm("vazio")).toBe("null");
  });

  it("histórico com FKs (apagar o pedido apaga os eventos; usuário solta) e fornecedor solta do pedido", () => {
    sql(`UPDATE pedidos_compra_interno SET fornecedor_id = 'f1' WHERE id = 'p1'`);
    sql(`INSERT INTO pedido_compra_eventos (id, empresa_id, pedido_id, tipo, usuario_id) VALUES ('ev1', 'e1', 'p1', 'CRIADO', 'u1')`);
    sql(`DELETE FROM usuarios WHERE id = 'u1'`);
    expect(sql(`SELECT coalesce(usuario_id, '∅') FROM pedido_compra_eventos`)).toBe("∅");
    sql(`DELETE FROM fornecedores WHERE id = 'f1'`);
    expect(sql(`SELECT coalesce(fornecedor_id, '∅') FROM pedidos_compra_interno WHERE id = 'p1'`)).toBe("∅");
    sql(`DELETE FROM pedidos_compra_interno WHERE id = 'p1'`);
    expect(sql(`SELECT count(*) FROM pedido_compra_eventos`)).toBe("0");
    expect(() => sql(`INSERT INTO pedido_compra_eventos (id, empresa_id, pedido_id, tipo) VALUES ('ev2', 'e1', 'naoexiste', 'X')`)).toThrow(/foreign key/i);
  });

  it("rodar os 2 de novo não falha nem mexe no que já foi preenchido", () => {
    const tokens = sql(`SELECT string_agg(token_publico, ',' ORDER BY id) FROM pedidos_compra_interno`);
    sql(`UPDATE pedidos_compra_interno SET status = 'PARCIAL', motivo = 'Reposição de estoque' WHERE id = 'p2'`);
    sql(`UPDATE perfis_acesso SET permissoes = jsonb_set(permissoes, '{compras,gerenciar}', 'false') WHERE id = 'fin'`);
    rodar(ENUM);
    rodar(DADOS);
    expect(sql(`SELECT string_agg(token_publico, ',' ORDER BY id) FROM pedidos_compra_interno`)).toBe(tokens);
    expect(sql(`SELECT status || '|' || motivo FROM pedidos_compra_interno WHERE id = 'p2'`)).toBe("PARCIAL|Reposição de estoque");
    // Quem tirou o "gerenciar" do perfil depois não ganha de volta
    expect(sql(`SELECT permissoes -> 'compras' ->> 'gerenciar' FROM perfis_acesso WHERE id = 'fin'`)).toBe("false");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = '${SCHEMA}'::regnamespace`)).toBe("4");
  });
});
