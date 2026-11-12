/**
 * Compras 2/2 — Conciliação NF ↔ PC: o SQL de produção rodado de verdade num PostgreSQL, numa transação
 * só (como o `prisma db execute`), DUAS vezes, num schema descartável com as tabelas como estão HOJE:
 *  - pedido ganha "nf_vinculada_em"/"nf_vista_em" (vazias; pedidos antigos intactos);
 *  - vínculo por item: único por (item do pedido, item da NF), FKs para empresa/pedido/itens/nota
 *    (apagar o item ou a nota leva o vínculo junto; apagar o usuário só solta o autor);
 *  - 2ª rodada: nada muda, nada duplica.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-compras-conciliacao
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-03_compras_conciliacao_nf.sql");
const SCHEMA = `teste_compras_conc_sql_${process.pid}`;

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
const coluna = (tabela: string, nome: string) => sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${nome}'`);
const vinculo = (id: string, pi: string, ni: string, extra = "") =>
  `INSERT INTO pedido_compra_vinculos (id, empresa_id, pedido_id, pedido_item_id, nota_id, nota_item_id, quantidade, valor_unitario${extra ? ", usuario_id" : ""}) VALUES ('${id}', 'e1', 'p1', '${pi}', 'n1', '${ni}', 4, 12.5${extra ? `, '${extra}'` : ""})`;

describe.skipIf(!URL)("SQL de produção: conciliação NF ↔ Pedido de Compra (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "pedidos_compra_interno" ("id" TEXT PRIMARY KEY, "status" TEXT NOT NULL DEFAULT 'SOLICITADO');
      CREATE TABLE "pedidos_compra_item" ("id" TEXT PRIMARY KEY, "pedido_id" TEXT NOT NULL REFERENCES "pedidos_compra_interno"("id") ON DELETE CASCADE);
      CREATE TABLE "notas_compra" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "notas_compra_itens" ("id" TEXT PRIMARY KEY, "nota_id" TEXT NOT NULL REFERENCES "notas_compra"("id") ON DELETE CASCADE);
      INSERT INTO "empresas" VALUES ('e1');
      INSERT INTO "usuarios" VALUES ('u1'), ('u2');
      INSERT INTO "pedidos_compra_interno" VALUES ('p1', 'COTANDO'), ('p2', 'SOLICITADO');
      INSERT INTO "pedidos_compra_item" VALUES ('pi1', 'p1'), ('pi2', 'p1');
      INSERT INTO "notas_compra" VALUES ('n1');
      INSERT INTO "notas_compra_itens" VALUES ('ni1', 'n1'), ('ni2', 'n1');
    `);
    rodar();
    rodar(); // 2ª rodada: idempotente
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("pedido: colunas do aviso vazias e opcionais; pedidos antigos intactos", () => {
    expect(coluna("pedidos_compra_interno", "nf_vinculada_em")).toBe("timestamp without time zone:YES:-");
    expect(coluna("pedidos_compra_interno", "nf_vista_em")).toBe("timestamp without time zone:YES:-");
    expect(sql(`SELECT string_agg(id || '=' || status || '/' || COALESCE(nf_vinculada_em::text, '-'), ',' ORDER BY id) FROM pedidos_compra_interno`)).toBe("p1=COTANDO/-,p2=SOLICITADO/-");
  });

  it("tabela do vínculo: colunas e tipos (quantidade e custo com 4 casas)", () => {
    expect(coluna("pedido_compra_vinculos", "quantidade")).toBe("numeric:NO:-");
    expect(sql(`SELECT numeric_precision || ',' || numeric_scale FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'pedido_compra_vinculos' AND column_name IN ('quantidade','valor_unitario','valor_real_anterior') ORDER BY column_name`))
      .toBe("15,4\n12,2\n15,4");
    expect(coluna("pedido_compra_vinculos", "criterio")).toBe("text:NO:'PRODUTO'::text");
    expect(coluna("pedido_compra_vinculos", "automatico")).toBe("boolean:NO:false");
    expect(coluna("pedido_compra_vinculos", "usuario_id")).toBe("text:YES:-");
  });

  it("vincular 2× o mesmo par não duplica (único); outro item da NF no mesmo item do pedido pode", () => {
    sql(vinculo("v1", "pi1", "ni1", "u1"));
    expect(erro(vinculo("v2", "pi1", "ni1"))).toMatch(/duplicate key value violates unique constraint "pedido_compra_vinculos_pedido_item_id_nota_item_id_key"/);
    sql(vinculo("v3", "pi1", "ni2"));
    sql(vinculo("v4", "pi2", "ni2", "u2"));
    expect(sql(`SELECT count(*) FROM pedido_compra_vinculos`)).toBe("3");
  });

  it("FKs: pedido/nota/itens inexistentes recusados; apagar item da NF leva o vínculo; usuário apagado solta o autor", () => {
    const insere = (pedido: string, pedidoItem: string, nota: string, notaItem: string, empresa = "e1") =>
      erro(`INSERT INTO pedido_compra_vinculos (id, empresa_id, pedido_id, pedido_item_id, nota_id, nota_item_id, quantidade, valor_unitario) VALUES ('x', '${empresa}', '${pedido}', '${pedidoItem}', '${nota}', '${notaItem}', 1, 1)`);
    expect(insere("p1", "pi2", "n1", "nao-existe")).toMatch(/pedido_compra_vinculos_nota_item_id_fkey/);
    expect(insere("nao-existe", "pi2", "n1", "ni1")).toMatch(/pedido_compra_vinculos_pedido_id_fkey/);
    expect(insere("p1", "nao-existe", "n1", "ni1")).toMatch(/pedido_compra_vinculos_pedido_item_id_fkey/);
    expect(insere("p1", "pi2", "nao-existe", "ni1")).toMatch(/pedido_compra_vinculos_nota_id_fkey/);
    expect(insere("p1", "pi2", "n1", "ni1", "nao-existe")).toMatch(/pedido_compra_vinculos_empresa_id_fkey/);
    sql(`DELETE FROM usuarios WHERE id = 'u1'`);
    expect(sql(`SELECT COALESCE(usuario_id, '-') FROM pedido_compra_vinculos WHERE id = 'v1'`)).toBe("-");
    sql(`DELETE FROM notas_compra_itens WHERE id = 'ni2'`);
    expect(sql(`SELECT string_agg(id, ',' ORDER BY id) FROM pedido_compra_vinculos`)).toBe("v1");
    sql(`DELETE FROM pedidos_compra_item WHERE id = 'pi1'`);
    expect(sql(`SELECT count(*) FROM pedido_compra_vinculos`)).toBe("0");
  });

  it("3ª rodada com dados: nada muda", () => {
    sql(vinculo("v9", "pi2", "ni1"));
    rodar();
    expect(sql(`SELECT count(*) FROM pedido_compra_vinculos`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE conrelid = '${SCHEMA}.pedido_compra_vinculos'::regclass AND contype = 'f'`)).toBe("6");
  });
});
