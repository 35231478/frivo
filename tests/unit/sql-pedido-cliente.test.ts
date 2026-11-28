/**
 * Pedido do cliente (PC-1) — o SQL de produção (prisma/sql/2027-02-11_pedido_cliente.sql) rodado de verdade num PostgreSQL
 * descartável, a partir do banco como está hoje (o Prisma do master, sem as colunas novas), com linhas dentro:
 *  - idempotente (roda duas vezes);
 *  - o resultado é EXATAMENTE o que o Prisma espera: colunas, tipos, padrões, índices e chaves;
 *  - as linhas que já existiam não mudam (as colunas novas nascem nulas/falsas; o prazo do aviso, 7 dias);
 *  - nenhum perfil de acesso é alterado (o arquivo nem toca em perfis_acesso) e nada é apagado.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-pedido-cliente
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-11_pedido_cliente.sql");
const SCHEMA = `teste_sql_pedido_${process.pid}`;
const PRISMA = `teste_sql_pedido_prisma_${process.pid}`;
const TABELAS = ["clientes", "unidades", "pedidos_cliente", "ordens_servico", "orcamentos", "configuracoes"];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const colunas = (schema: string, t: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || is_nullable || ' ' || replace(coalesce(column_default, '-'), '${schema}.', '') || ' ' || coalesce(numeric_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${t}' ORDER BY column_name`);
const indices = (schema: string, t: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${t}' ORDER BY indexname`);
const chaves = (schema: string, t: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${t}'::regclass ORDER BY conname`);
const push = (schema: string) => execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
  cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}` }, stdio: "pipe",
});

describe.skipIf(!URL)("SQL de produção: pedido do cliente (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]);
    push(PRISMA);
    // O banco de hoje: o Prisma sem o que este SQL cria, com linhas dentro
    push(SCHEMA);
    sql(`ALTER TABLE "ordens_servico" DROP COLUMN "pedido_cliente_id", DROP COLUMN "pedido_liberado_em", DROP COLUMN "pedido_liberado_por_id", DROP COLUMN "pedido_liberado_motivo";
      ALTER TABLE "orcamentos" DROP COLUMN "pedido_cliente_id", DROP COLUMN "pedido_liberado_em", DROP COLUMN "pedido_liberado_por_id", DROP COLUMN "pedido_liberado_motivo";
      DROP TABLE "pedidos_cliente";
      ALTER TABLE "clientes" DROP COLUMN "exige_pedido_executar", DROP COLUMN "compras_nome", DROP COLUMN "compras_email", DROP COLUMN "compras_telefone";
      ALTER TABLE "unidades" DROP COLUMN "exige_pedido";
      ALTER TABLE "configuracoes" DROP COLUMN "pedido_cliente_dias_alerta";
      SET session_replication_role = replica;
      INSERT INTO "clientes" ("id", "empresa_id", "nome", "cpf_cnpj", "exige_pc_antes_nf", "atualizado_em") VALUES ('c1', 'e1', 'Instituto', '1', true, now());
      INSERT INTO "configuracoes" ("id", "empresa_id") VALUES ('cfg1', 'e1');`);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]); // 2ª vez: idempotente
    // Produção recebe depois o SQL da PC-2 (portal + lembretes), que acrescenta colunas nestas mesmas tabelas: o Prisma
    // de hoje já as tem. O que a PC-2 muda é provado em sql-pedido-cliente-portal; aqui ela só completa a sequência.
    psql(["-f", path.join(RAIZ, "prisma/sql/2027-02-12_pedido_cliente_portal_lembretes.sql")]);
  }, 240_000);
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`]); });

  it("as tabelas ficam IDÊNTICAS às do Prisma: colunas, tipos, padrões, índices e chaves", () => {
    for (const t of TABELAS) {
      expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), t).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), t).toBe(chaves(PRISMA, t));
    }
  });

  it("as linhas que já existiam continuam iguais: 'para faturar' fica como estava; o resto nasce vazio; o aviso em 7 dias", () => {
    expect(sql(`SELECT exige_pc_antes_nf || ' ' || exige_pedido_executar || ' ' || coalesce(compras_nome, 'NULO') FROM "clientes" WHERE id = 'c1'`)).toBe("true false NULO");
    expect(sql(`SELECT pedido_cliente_dias_alerta FROM "configuracoes" WHERE id = 'cfg1'`)).toBe("7");
  });

  it("o arquivo só acrescenta: nada de DROP, DELETE, UPDATE nem mexer em perfis de acesso", () => {
    const comandos = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    // nenhum comando que apaga ou muda linha (o "ON DELETE/UPDATE" das chaves estrangeiras é regra da chave, não comando)
    expect(comandos).not.toMatch(/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im);
    expect(comandos).not.toMatch(/\b(DROP (TABLE|COLUMN)|DELETE FROM|UPDATE "|TRUNCATE)\b/i);
    expect(comandos).not.toMatch(/perfis_acesso|permissoes/i);
    expect(comandos.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(14); // cliente 4, unidade 1, OS 4, orçamento 4, configurações 1
  });
});
