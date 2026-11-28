/**
 * COM-2A — o SQL de produção (prisma/sql/2027-02-14_comissao_executor.sql) num PostgreSQL descartável, a partir do
 * banco de hoje (com a COM-1, sem a COM-2), com linhas dentro: roda 2×; a regra, a comissão do vendedor e a
 * configuração que existiam ficam como estavam (divisão Igual, parte 1, gatilho do técnico na conclusão, 30 dias);
 * a comissão agora pode vir só da OS, mas nunca de nenhuma das duas; os CHECKs recusam o que não vale; e o resultado
 * é o que o Prisma espera (migrate diff vazio).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-com2-executor
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-14_comissao_executor.sql");
const SCHEMA = `teste_sql_com2_${process.pid}`;
const urlDo = (schema: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}`;
const psql = (args: string[]) => execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
  env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
}).trim();
const sql = (q: string) => psql(["-c", q]);
const falha = (q: string) => { try { sql(q); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };

describe.skipIf(!URL)("SQL de produção: COM-2A — comissão do técnico (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) }, stdio: "pipe",
    });
    // O banco de hoje: com a COM-1, sem nada da COM-2
    sql(`DROP TABLE comissao_revisoes; DROP TABLE comissao_tetos;
      DROP INDEX comissoes_empresa_id_chave_key; DROP INDEX comissoes_ordem_servico_id_idx; DROP INDEX comissao_lancamentos_empresa_id_teto_competencia_idx;
      ALTER TABLE comissoes DROP COLUMN ordem_servico_id, DROP COLUMN atividade_id, DROP COLUMN equipamento_id, DROP COLUMN parte, DROP COLUMN divisao, DROP COLUMN chave;
      ALTER TABLE comissoes ALTER COLUMN orcamento_id SET NOT NULL;
      ALTER TABLE comissao_regras DROP COLUMN divisao, DROP COLUMN divisao_cargos;
      ALTER TABLE comissao_lancamentos DROP COLUMN teto_competencia;
      ALTER TABLE configuracoes DROP COLUMN comissao_executor_quando, DROP COLUMN comissao_retorno_dias;
      SET session_replication_role = replica;
      INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e1', 'Fictícia', '45.723.174/0001-10', 'e@ficticio.test', now());
      INSERT INTO configuracoes (id, empresa_id) VALUES ('cfg1', 'e1');
      INSERT INTO comissao_regras (id, empresa_id, quem_tipo, sobre_tipo, base, valor, atualizado_em) VALUES ('r1', 'e1', 'TODOS', 'TODOS_SERVICOS', 'PERC_VENDA', 5, now());
      INSERT INTO comissoes (id, empresa_id, orcamento_id, beneficiario_nome, item_tipo, item_id, descricao, quantidade, regra_descricao, base, base_valor, taxa, valor, quando)
        VALUES ('c1', 'e1', 'o1', 'Vitor', 'SERVICO', 'l1', 'Instalação', 1, 'Todos · 5%', 'PERC_VENDA', 1000, 5, 50, 'RECEBIMENTO');
      SET session_replication_role = origin;`);
    psql(["-f", ARQUIVO]);
    sql(`UPDATE configuracoes SET comissao_retorno_dias = 15 WHERE id = 'cfg1'`); // gravado entre as rodadas
    psql(["-f", ARQUIVO]);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("o que existia fica como estava; rodar de novo não desfaz o que foi gravado", () => {
    expect(sql(`SELECT divisao || ' ' || coalesce(divisao_cargos::text, 'NULO') FROM comissao_regras WHERE id = 'r1'`)).toBe("IGUAL NULO");
    expect(sql(`SELECT orcamento_id || ' ' || parte || ' ' || coalesce(ordem_servico_id, 'NULO') || ' ' || coalesce(chave, 'NULO') FROM comissoes WHERE id = 'c1'`)).toBe("o1 1.0000 NULO NULO");
    expect(sql(`SELECT comissao_executor_quando || ' ' || comissao_retorno_dias FROM configuracoes WHERE id = 'cfg1'`)).toBe("CONCLUSAO_OS 15");
  });

  it("a comissão pode vir só da OS (orçamento vazio), mas nunca de nenhuma das duas; a chave não repete; os CHECKs recusam o que não vale", () => {
    sql(`SET session_replication_role = replica;
      INSERT INTO comissoes (id, empresa_id, ordem_servico_id, chave, beneficiario_nome, item_tipo, item_id, descricao, quantidade, regra_descricao, base, base_valor, taxa, valor, quando, parte, divisao)
        VALUES ('c2', 'e1', 'os1', 'EXEC:os1:a1:q1:l1:u1', 'Carlos', 'SERVICO', 'l1', 'Limpeza', 1, 'Todos · 10%', 'PERC_VENDA', 100, 10, 5, 'CONCLUSAO_OS', 0.5, 'IGUAL');`);
    expect(sql(`SELECT count(*) FROM comissoes WHERE orcamento_id IS NULL`)).toBe("1");
    const base = `INSERT INTO comissoes (id, empresa_id, ordem_servico_id, orcamento_id, chave, beneficiario_nome, item_tipo, item_id, descricao, quantidade, regra_descricao, base, base_valor, taxa, valor, quando, parte)`;
    expect(falha(`${base} VALUES ('c3', 'e1', NULL, NULL, NULL, 'X', 'SERVICO', 'l', 'd', 1, 'r', 'PERC_VENDA', 1, 1, 1, 'X', 1)`)).toMatch(/comissoes_origem_check/);
    expect(falha(`${base} VALUES ('c4', 'e1', 'os1', NULL, 'EXEC:os1:a1:q1:l1:u1', 'X', 'SERVICO', 'l', 'd', 1, 'r', 'PERC_VENDA', 1, 1, 1, 'X', 1)`)).toMatch(/comissoes_empresa_id_chave_key/);
    expect(falha(`${base} VALUES ('c5', 'e1', 'os1', NULL, NULL, 'X', 'SERVICO', 'l', 'd', 1, 'r', 'PERC_VENDA', 1, 1, 1, 'X', 1.5)`)).toMatch(/comissoes_parte_check/);
    expect(falha(`UPDATE comissao_regras SET divisao = 'OUTRA' WHERE id = 'r1'`)).toMatch(/comissao_regras_divisao_check/);
    expect(falha(`UPDATE configuracoes SET comissao_executor_quando = 'APROVACAO'`)).toMatch(/configuracoes_comissao_executor_quando_check/);
    expect(falha(`UPDATE configuracoes SET comissao_retorno_dias = 366`)).toMatch(/configuracoes_comissao_retorno_dias_check/);
    expect(falha(`INSERT INTO comissao_tetos (id, empresa_id, quem_tipo, valor, atualizado_em) VALUES ('t1', 'e1', 'TODOS', 10, now())`)).toMatch(/comissao_tetos_quem_check/);
    expect(falha(`INSERT INTO comissao_tetos (id, empresa_id, quem_tipo, valor, atualizado_em) VALUES ('t2', 'e1', 'PESSOA', 0, now())`)).toMatch(/comissao_tetos_valor_check/);
    sql(`SET session_replication_role = origin`);
  });

  it("o SQL só acrescenta (a única flexibilização é o orcamento_id deixar de ser obrigatório)", () => {
    const texto = require("node:fs").readFileSync(ARQUIVO, "utf8").split("\n").filter((l: string) => !l.trim().startsWith("--")).join("\n")
      .replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/g, ""); // a regra das chaves estrangeiras não é comando
    expect(texto).not.toMatch(/\b(DROP TABLE|DROP COLUMN|DELETE|UPDATE|TRUNCATE)\b/i);
    expect(texto.match(/DROP NOT NULL/g)).toEqual(["DROP NOT NULL"]);
    expect(texto).toMatch(/ALTER TABLE "comissoes" ALTER COLUMN "orcamento_id" DROP NOT NULL;/);
  });

  it("dá exatamente o que o Prisma espera (migrate diff vazio)", () => {
    sql(`DELETE FROM comissoes WHERE id = 'c2'`);
    const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["migrate", "diff", "--from-url", urlDo(SCHEMA), "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) } });
    expect(diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"))).toEqual([]);
  });
});
