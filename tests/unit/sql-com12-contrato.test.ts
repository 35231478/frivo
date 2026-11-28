/**
 * COM-1.2 — o SQL de produção (prisma/sql/2027-02-15_comissao_contrato.sql) num PostgreSQL descartável, a partir do
 * banco de hoje (com a COM-1, a COM-1.1 e a COM-2, sem a COM-1.2), com linhas dentro: roda 3×; o contrato, a regra,
 * a comissão e a configuração que existiam ficam como estavam (contrato SEM vendedor: não gera — sem retroativo; a
 * renovação não gera); os CHECKs ampliados aceitam o novo e continuam recusando o que não vale; a comissão pode vir
 * de um contrato, mas nunca de nada; e o resultado é o que o Prisma espera (migrate diff vazio).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-com12-contrato
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-15_comissao_contrato.sql");
const SCHEMA = `teste_sql_com12_${process.pid}`;
const urlDo = (schema: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}`;
const psql = (args: string[]) => execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
  env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
}).trim();
const sql = (q: string) => psql(["-c", q]);
const falha = (q: string) => { try { sql(q); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };

describe.skipIf(!URL)("SQL de produção: COM-1.2 — comissão sobre contrato (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) }, stdio: "pipe",
    });
    // O banco de hoje: com a COM-1/1.1/2 (e os CHECKs delas), sem nada da COM-1.2
    psql(["-f", path.join(RAIZ, "prisma/sql/2027-02-11_comissoes.sql")]);
    psql(["-f", path.join(RAIZ, "prisma/sql/2027-02-14_comissao_executor.sql")]);
    sql(`DROP INDEX contratos_empresa_id_vendedor_id_idx; DROP INDEX comissoes_contrato_id_idx;
      ALTER TABLE contratos DROP COLUMN vendedor_id;
      ALTER TABLE comissao_regras DROP COLUMN tipo_contrato, DROP COLUMN meses;
      ALTER TABLE comissoes DROP COLUMN contrato_id, DROP COLUMN competencia, DROP COLUMN ciclo_inicio, DROP COLUMN meses;
      ALTER TABLE configuracoes DROP COLUMN comissao_renovacao_gera;
      ALTER TABLE comissoes DROP CONSTRAINT IF EXISTS comissoes_origem_check;
      ALTER TABLE comissoes ADD CONSTRAINT comissoes_origem_check CHECK (orcamento_id IS NOT NULL OR ordem_servico_id IS NOT NULL);
      SET session_replication_role = replica;
      INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e1', 'Fictícia', '45.723.174/0001-10', 'e@ficticio.test', now());
      INSERT INTO configuracoes (id, empresa_id) VALUES ('cfg1', 'e1');
      INSERT INTO contratos (id, empresa_id, cliente_id, numero, tipo, status, data_inicio, atualizado_em) VALUES ('ct1', 'e1', 'cl1', 'CT-1', 'LOCACAO', 'ATIVO', now(), now());
      INSERT INTO comissao_regras (id, empresa_id, quem_tipo, sobre_tipo, base, valor, atualizado_em) VALUES ('r1', 'e1', 'TODOS', 'TODOS_SERVICOS', 'PERC_VENDA', 5, now());
      INSERT INTO comissoes (id, empresa_id, orcamento_id, beneficiario_nome, item_tipo, item_id, descricao, quantidade, regra_descricao, base, base_valor, taxa, valor, quando)
        VALUES ('c1', 'e1', 'o1', 'Vitor', 'SERVICO', 'l1', 'Instalação', 1, 'Todos · 5%', 'PERC_VENDA', 1000, 5, 50, 'RECEBIMENTO');
      SET session_replication_role = origin;`);
    psql(["-f", ARQUIVO]);
    sql(`UPDATE configuracoes SET comissao_renovacao_gera = true WHERE id = 'cfg1'`); // gravado entre as rodadas
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("o que existia fica como estava: contrato antigo SEM vendedor (não gera), regra e comissão intactas; rodar de novo não desfaz o gravado", () => {
    expect(sql(`SELECT coalesce(vendedor_id, 'NULO') FROM contratos WHERE id = 'ct1'`)).toBe("NULO");
    expect(sql(`SELECT sobre_tipo || ' ' || base || ' ' || coalesce(tipo_contrato, 'NULO') || ' ' || coalesce(meses::text, 'NULO') FROM comissao_regras WHERE id = 'r1'`)).toBe("TODOS_SERVICOS PERC_VENDA NULO NULO");
    expect(sql(`SELECT orcamento_id || ' ' || coalesce(contrato_id, 'NULO') || ' ' || coalesce(competencia, 'NULO') FROM comissoes WHERE id = 'c1'`)).toBe("o1 NULO NULO");
    expect(sql(`SELECT comissao_renovacao_gera FROM configuracoes WHERE id = 'cfg1'`)).toBe("t");
    // Configuração nova nasce com a renovação desligada
    sql(`INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e2', 'Outra', '11.222.333/0001-81', 'o@ficticio.test', now()); INSERT INTO configuracoes (id, empresa_id) VALUES ('cfg2', 'e2')`);
    expect(sql(`SELECT comissao_renovacao_gera FROM configuracoes WHERE id = 'cfg2'`)).toBe("f");
  });

  it("os CHECKs ampliados aceitam Contratos e as bases dele, e continuam recusando o que não vale", () => {
    sql(`INSERT INTO comissao_regras (id, empresa_id, quem_tipo, sobre_tipo, base, valor, tipo_contrato, meses, atualizado_em) VALUES ('r2', 'e1', 'TODOS', 'CONTRATOS', 'PERC_MENSALIDADE', 5, 'LOCACAO', 0, now())`);
    sql(`INSERT INTO comissao_regras (id, empresa_id, quem_tipo, sobre_tipo, base, valor, atualizado_em) VALUES ('r3', 'e1', 'TODOS', 'CONTRATOS', 'FIXO_CONTRATO', 200, now())`);
    expect(falha(`UPDATE comissao_regras SET sobre_tipo = 'OUTRO' WHERE id = 'r1'`)).toMatch(/comissao_regras_sobre_check/);
    expect(falha(`UPDATE comissao_regras SET base = 'OUTRA' WHERE id = 'r1'`)).toMatch(/comissao_regras_base_check/);
    expect(falha(`UPDATE comissao_regras SET tipo_contrato = 'PMOC' WHERE id = 'r2'`)).toMatch(/comissao_regras_tipo_contrato_check/);
    expect(falha(`UPDATE comissao_regras SET meses = 121 WHERE id = 'r2'`)).toMatch(/comissao_regras_meses_check/);
    expect(falha(`UPDATE comissao_regras SET meses = -1 WHERE id = 'r2'`)).toMatch(/comissao_regras_meses_check/);
    // Os valores antigos continuam valendo (os CHECKs só foram ampliados)
    sql(`UPDATE comissao_regras SET sobre_tipo = 'PECAS', base = 'FIXO_ITEM' WHERE id = 'r1'`);
  });

  it("a comissão pode vir de um contrato (sem orçamento nem OS), mas nunca de nada; apagar o contrato leva as comissões dele", () => {
    sql(`SET session_replication_role = replica;
      INSERT INTO comissoes (id, empresa_id, contrato_id, competencia, ciclo_inicio, meses, chave, beneficiario_nome, item_tipo, item_id, descricao, quantidade, regra_descricao, base, base_valor, taxa, valor, quando)
        VALUES ('c2', 'e1', 'ct1', '2027-05', '2027-05', 3, 'ct:ct1:2027-05:2027-05:u1', 'Vitor', 'MENSALIDADE', '2027-05', 'Mensalidade 05/2027', 1, 'Todos · Todos os contratos · 5%', 'PERC_MENSALIDADE', 1000, 5, 50, 'RECEBIMENTO');
      SET session_replication_role = origin;`);
    const base = `INSERT INTO comissoes (id, empresa_id, beneficiario_nome, item_tipo, item_id, descricao, quantidade, regra_descricao, base, base_valor, taxa, valor, quando)`;
    expect(falha(`${base} VALUES ('c3', 'e1', 'X', 'MENSALIDADE', 'm', 'd', 1, 'r', 'PERC_MENSALIDADE', 1, 1, 1, 'RECEBIMENTO')`)).toMatch(/comissoes_origem_check/);
    expect(falha(`UPDATE contratos SET vendedor_id = 'nao-existe' WHERE id = 'ct1'`)).toMatch(/contratos_vendedor_id_fkey/);
    sql(`DELETE FROM contratos WHERE id = 'ct1'`);
    expect(sql(`SELECT count(*) FROM comissoes WHERE id = 'c2'`)).toBe("0");
  });

  it("o SQL só acrescenta: nada de DROP TABLE/COLUMN, UPDATE, DELETE ou TRUNCATE; só os três CHECKs são trocados por versões maiores", () => {
    const texto = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
      .replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/g, ""); // a regra das chaves estrangeiras não é comando
    expect(texto).not.toMatch(/\b(DROP TABLE|DROP COLUMN|DROP NOT NULL|DELETE|UPDATE|TRUNCATE)\b/i);
    expect(texto.match(/DROP CONSTRAINT IF EXISTS "[a-z_]+"/g)).toEqual([
      'DROP CONSTRAINT IF EXISTS "comissao_regras_sobre_check"', 'DROP CONSTRAINT IF EXISTS "comissao_regras_base_check"', 'DROP CONSTRAINT IF EXISTS "comissoes_origem_check"',
    ]);
  });

  it("dá exatamente o que o Prisma espera (migrate diff vazio)", () => {
    const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["migrate", "diff", "--from-url", urlDo(SCHEMA), "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) } });
    expect(diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"))).toEqual([]);
  });
});
