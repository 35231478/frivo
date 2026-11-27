/**
 * "Orçamento E2 — regra de materiais por empresa": o SQL de produção (prisma/sql/2027-02-07_cobranca_materiais.sql)
 * rodado de verdade num PostgreSQL. Produção simulada = o schema de hoje SEM o que esta leva acrescenta (sem o tipo e as
 * três colunas), com empresas, orçamentos e OS (com e sem materiais) fictícios. O arquivo roda DUAS vezes e:
 *  - cria o tipo e as colunas; empresa e orçamento que já existem ficam INCLUSO (como eram);
 *  - a OS que já tem materiais fica INCLUSO (é como os valores dela foram calculados); a sem materiais fica nula;
 *  - rodar de novo não desfaz uma regra fixada depois (OS que virou A_PARTE continua A_PARTE);
 *  - deixa o banco exatamente como o Prisma espera (migrate diff vazio) e não apaga nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-cobranca-materiais
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-07_cobranca_materiais.sql");
const SCHEMA = `teste_cobranca_mat_${process.pid}`;
const urlDo = (schema: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["-f", ARQUIVO]);

describe.skipIf(!URL)("SQL de produção: regra de cobrança dos materiais por empresa — PostgreSQL real", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) }, stdio: "pipe",
    });
    // Produção HOJE: sem o tipo e sem as três colunas
    sql(`ALTER TABLE configuracoes DROP COLUMN orcamento_cobranca_materiais; ALTER TABLE orcamentos DROP COLUMN cobranca_materiais;
         ALTER TABLE ordens_servico DROP COLUMN cobranca_materiais; DROP TYPE "CobrancaMateriais";`);
    const semPadrao = sql(`SELECT table_name FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND column_name = 'atualizado_em' AND column_default IS NULL`).split("\n").filter(Boolean);
    for (const t of semPadrao) sql(`ALTER TABLE "${t}" ALTER COLUMN atualizado_em SET DEFAULT now()`);
    // Dados fictícios
    sql(`
      INSERT INTO empresas (id, nome, cnpj, email) VALUES ('e1', 'Refrigeração Teste (fictícia)', '45.723.174/0001-10', 'e@ficticio.test');
      INSERT INTO usuarios (id, empresa_id, nome, email, senha) VALUES ('u1', 'e1', 'Ana', 'ana@ficticio.test', 'x');
      INSERT INTO clientes (id, empresa_id, nome, cpf_cnpj) VALUES ('c1', 'e1', 'Padaria Fictícia', '1');
      INSERT INTO configuracoes (id, empresa_id) VALUES ('cfg1', 'e1');
      INSERT INTO orcamentos (id, empresa_id, codigo, nome, cliente_id, criado_por_id, token_publico) VALUES ('o1', 'e1', 'ORC-1', 'Orçamento 1', 'c1', 'u1', 'tok-o1');
      INSERT INTO ordens_servico (id, empresa_id, numero, cliente_id, criado_por_id, descricao) VALUES
        ('osCom', 'e1', 'OS-1', 'c1', 'u1', 'Instalação'), ('osSem', 'e1', 'OS-2', 'c1', 'u1', 'Visita'), ('osDepois', 'e1', 'OS-3', 'c1', 'u1', 'Limpeza');
      INSERT INTO os_itens_orcamento (id, ordem_servico_id, tipo, descricao, quantidade, valor_unitario, valor_total) VALUES
        ('it1', 'osCom', 'SERVICO', 'Instalação', 1, 800, 800), ('it3', 'osDepois', 'SERVICO', 'Limpeza', 1, 150, 150);
      INSERT INTO os_materiais (id, ordem_servico_id, os_item_id, descricao, comportamento, quantidade, valor_venda_unit) VALUES
        ('m1', 'osCom', 'it1', 'Tubo', 'INCLUSO_NO_SERVICO', 3, 20), ('m3', 'osDepois', 'it3', 'Fita', 'INCLUSO_NO_SERVICO', 1, 10);
    `);
    for (const t of semPadrao) sql(`ALTER TABLE "${t}" ALTER COLUMN atualizado_em DROP DEFAULT`);
    rodar();
    // Depois da 1ª rodada, a OS-3 passa a "Cobrado à parte" (fixada pela tela): a 2ª rodada não pode desfazer
    sql(`UPDATE ordens_servico SET cobranca_materiais = 'A_PARTE' WHERE id = 'osDepois'`);
    rodar();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("empresa e orçamento que já existem ficam INCLUSO (como eram); os novos nascem INCLUSO pelo padrão", () => {
    expect(sql(`SELECT orcamento_cobranca_materiais FROM configuracoes WHERE id = 'cfg1'`)).toBe("INCLUSO");
    expect(sql(`SELECT cobranca_materiais FROM orcamentos WHERE id = 'o1'`)).toBe("INCLUSO");
    sql(`INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e2', 'Outra (fictícia)', '1', 'o@ficticio.test', now());
         INSERT INTO configuracoes (id, empresa_id) VALUES ('cfg2', 'e2');
         INSERT INTO orcamentos (id, empresa_id, codigo, nome, cliente_id, criado_por_id, token_publico, atualizado_em) VALUES ('o2', 'e1', 'ORC-2', 'O2', 'c1', 'u1', 'tok-o2', now());`);
    expect(sql(`SELECT orcamento_cobranca_materiais FROM configuracoes WHERE id = 'cfg2'`)).toBe("INCLUSO");
    expect(sql(`SELECT cobranca_materiais FROM orcamentos WHERE id = 'o2'`)).toBe("INCLUSO");
  });

  it("OS com materiais = INCLUSO; OS sem materiais = nula (a regra é fixada no 1º item com materiais)", () => {
    expect(sql(`SELECT cobranca_materiais FROM ordens_servico WHERE id = 'osCom'`)).toBe("INCLUSO");
    expect(sql(`SELECT coalesce(cobranca_materiais::text, 'nula') FROM ordens_servico WHERE id = 'osSem'`)).toBe("nula");
  });

  it("rodar de novo não desfaz a regra fixada depois", () => {
    expect(sql(`SELECT cobranca_materiais FROM ordens_servico WHERE id = 'osDepois'`)).toBe("A_PARTE");
  });

  it("só os dois valores: outro valor é recusado; empresa e orçamento não aceitam nulo", () => {
    expect(() => sql(`UPDATE configuracoes SET orcamento_cobranca_materiais = 'GRATIS' WHERE id = 'cfg1'`)).toThrow();
    expect(() => sql(`UPDATE configuracoes SET orcamento_cobranca_materiais = NULL WHERE id = 'cfg1'`)).toThrow();
    expect(() => sql(`UPDATE orcamentos SET cobranca_materiais = NULL WHERE id = 'o1'`)).toThrow();
  });

  it("dá exatamente o que o Prisma espera: o migrate diff contra o schema.prisma fica vazio", () => {
    const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), [
      "migrate", "diff", "--from-url", urlDo(SCHEMA), "--to-schema-datamodel", "prisma/schema.prisma", "--script",
    ], { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) } });
    const comandos = diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
    expect(comandos).toEqual([]);
  });

  it("o arquivo não apaga nada e só preenche OS onde a regra ainda é nula", () => {
    const comandos = readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(comandos).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
    const updates = comandos.match(/UPDATE[\s\S]*?;/g) ?? [];
    expect(updates.length).toBe(1);
    expect(updates[0]).toMatch(/"cobranca_materiais" IS NULL/);
    expect(comandos).not.toMatch(/mostrar_valores_materiais/);
  });
});
