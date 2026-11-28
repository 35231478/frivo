/**
 * PC-2 — o SQL de produção (prisma/sql/2027-02-12_pedido_cliente_portal_lembretes.sql) rodado de verdade num
 * PostgreSQL descartável, a partir do banco como ele fica depois da PC-1 (o Prisma de hoje sem o que este SQL cria),
 * com linhas dentro:
 *  - idempotente (roda duas vezes; o que o sistema gravou entre uma rodada e outra não é desfeito);
 *  - o pedido que já existe fica "ESCRITORIO" / "CONFIRMADO" (nada muda para ele); empresa e cliente com lembretes
 *    ligados e a régua 3, 7 e 15;
 *  - a chave do lembrete é única (é o que impede o cron de mandar a mesma etapa duas vezes);
 *  - o resultado é EXATAMENTE o que o Prisma espera (migrate diff vazio).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-pedido-cliente-portal
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-12_pedido_cliente_portal_lembretes.sql");
const SCHEMA = `teste_sql_pc2_${process.pid}`;
const urlDo = (schema: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}`;
function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["-f", ARQUIVO]);

describe.skipIf(!URL)("SQL de produção: pedido do cliente no portal + lembretes (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) }, stdio: "pipe",
    });
    // produção HOJE (depois da PC-1): sem o que este SQL cria
    sql(`DROP TABLE pedidos_cliente_lembretes;
      DROP INDEX pedidos_cliente_empresa_id_situacao_idx;
      ALTER TABLE pedidos_cliente DROP COLUMN origem, DROP COLUMN situacao, DROP COLUMN os_propostas, DROP COLUMN orcamentos_propostos,
        DROP COLUMN enviado_por_contato_id, DROP COLUMN conferido_em, DROP COLUMN conferido_por_id, DROP COLUMN motivo_recusa;
      ALTER TABLE configuracoes DROP COLUMN pedido_lembretes_ativo, DROP COLUMN pedido_lembretes_dias;
      ALTER TABLE clientes DROP COLUMN pedido_lembretes_ativo;`);
    sql(`
      INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e1', 'Refrigeração Teste (fictícia)', '45.723.174/0001-10', 'e@ficticio.test', now());
      INSERT INTO configuracoes (id, empresa_id) VALUES ('cfg1', 'e1');
      INSERT INTO clientes (id, empresa_id, nome, cpf_cnpj, exige_pc_antes_nf, compras_email, atualizado_em) VALUES ('c1', 'e1', 'Indústria Fictícia', '1', true, 'compras@ficticio.test', now());
      INSERT INTO pedidos_cliente (id, empresa_id, cliente_id, numero, data, criado_por_id) VALUES ('p1', 'e1', 'c1', '4500001', '2026-11-01', 'u1');
    `);
    rodar();
    // entre uma rodada e outra o sistema gravou: um pedido do portal em conferência, a régua mudada e um cliente desligado
    sql(`INSERT INTO pedidos_cliente (id, empresa_id, cliente_id, numero, data, origem, situacao, os_propostas) VALUES ('p2', 'e1', 'c1', '4500002', '2026-11-20', 'PORTAL', 'CONFERIR', ARRAY['os1']);
      UPDATE configuracoes SET pedido_lembretes_dias = ARRAY[5, 10] WHERE id = 'cfg1';
      UPDATE clientes SET pedido_lembretes_ativo = false WHERE id = 'c1';`);
    rodar();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("o pedido que já existia fica do escritório e confirmado, sem propostas: nada muda para ele", () => {
    expect(sql(`SELECT origem || ' ' || situacao || ' ' || cardinality(os_propostas) || ' ' || coalesce(motivo_recusa, 'NULO') FROM pedidos_cliente WHERE id = 'p1'`)).toBe("ESCRITORIO CONFIRMADO 0 NULO");
  });
  it("rodar de novo não desfaz o que o sistema gravou no meio", () => {
    expect(sql(`SELECT situacao || ' ' || array_to_string(os_propostas, ',') FROM pedidos_cliente WHERE id = 'p2'`)).toBe("CONFERIR os1");
    expect(sql(`SELECT array_to_string(pedido_lembretes_dias, ',') || ' ' || pedido_lembretes_ativo FROM configuracoes WHERE id = 'cfg1'`)).toBe("5,10 true");
    expect(sql(`SELECT pedido_lembretes_ativo FROM clientes WHERE id = 'c1'`)).toBe("f");
  });
  it("empresa e cliente novos: lembretes ligados, régua 3, 7 e 15", () => {
    sql(`INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e2', 'Outra (fictícia)', '11.222.333/0001-81', 'o@ficticio.test', now());
      INSERT INTO configuracoes (id, empresa_id) VALUES ('cfg2', 'e2'); INSERT INTO clientes (id, empresa_id, nome, cpf_cnpj, atualizado_em) VALUES ('c2', 'e1', 'Outro', '2', now());`);
    expect(sql(`SELECT array_to_string(pedido_lembretes_dias, ',') || ' ' || pedido_lembretes_ativo FROM configuracoes WHERE id = 'cfg2'`)).toBe("3,7,15 true");
    expect(sql(`SELECT pedido_lembretes_ativo FROM clientes WHERE id = 'c2'`)).toBe("t");
  });
  it("a chave do lembrete é única: a mesma etapa do mesmo item não entra duas vezes", () => {
    const ins = (id: string) => sql(`INSERT INTO pedidos_cliente_lembretes (id, empresa_id, cliente_id, ordem_servico_id, etapa, chave, envio, para) VALUES ('${id}', 'e1', 'c1', 'os1', 3, 'os:os1:3', 'env', 'compras@ficticio.test')`);
    ins("l1");
    expect(() => ins("l2")).toThrow(/duplicate key|unique/i);
    expect(sql(`SELECT count(*) FROM pedidos_cliente_lembretes`)).toBe("1");
  });
  it("dá exatamente o que o Prisma espera: o migrate diff contra o schema.prisma fica vazio", () => {
    const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), [
      "migrate", "diff", "--from-url", urlDo(SCHEMA), "--to-schema-datamodel", "prisma/schema.prisma", "--script",
    ], { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) } });
    expect(diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"))).toEqual([]);
  });
});
