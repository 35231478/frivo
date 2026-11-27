/**
 * "Orçamento E — Material × Peça": o SQL de produção (prisma/sql/2027-02-06_produto_uso_material_peca.sql) rodado de
 * verdade num PostgreSQL. Produção simulada = o schema de hoje SEM o que esta leva acrescenta (sem a coluna, sem o
 * tipo, os padrões antigos), com produtos usados de jeitos diferentes. O arquivo roda DUAS vezes e:
 *  - cria o tipo e a coluna, preenche pela origem mais usada (empate → categoria; sem categoria → Material);
 *  - não desfaz, na 2ª rodada, uma escolha feita depois no cadastro;
 *  - muda só o PADRÃO de "mostrar materiais" (o que já está gravado fica);
 *  - deixa o banco exatamente como o Prisma espera (migrate diff vazio para o que esta leva toca).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-produto-uso
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-06_produto_uso_material_peca.sql");
const SCHEMA = `teste_produto_uso_${process.pid}`;
const urlDo = (schema: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["-f", ARQUIVO]);
const usoDe = (id: string) => sql(`SELECT uso FROM produtos WHERE id = '${id}'`);

describe.skipIf(!URL)("SQL de produção: Uso do produto (Material × Peça) — PostgreSQL real", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) }, stdio: "pipe",
    });
    // Produção HOJE: sem o Uso e com os padrões antigos do "mostrar materiais"
    sql(`ALTER TABLE produtos DROP COLUMN uso; DROP TYPE "UsoProduto";
         ALTER TABLE configuracoes ALTER COLUMN orcamento_mostrar_materiais SET DEFAULT false;
         ALTER TABLE orcamentos ALTER COLUMN mostrar_materiais SET DEFAULT false;`);
    // Colunas "atualizado_em" (sem padrão no banco: quem preenche é o Prisma) ganham um padrão só para os INSERTs abaixo
    const semPadrao = sql(`SELECT table_name FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND column_name = 'atualizado_em' AND column_default IS NULL`).split("\n").filter(Boolean);
    for (const t of semPadrao) sql(`ALTER TABLE "${t}" ALTER COLUMN atualizado_em SET DEFAULT now()`);
    // Dados fictícios: cada produto usado de um jeito
    sql(`
      INSERT INTO empresas (id, nome, cnpj, email) VALUES ('e1', 'Refrigeração Teste (fictícia)', '45.723.174/0001-10', 'e@ficticio.test');
      INSERT INTO usuarios (id, empresa_id, nome, email, senha) VALUES ('u1', 'e1', 'Ana', 'ana@ficticio.test', 'x');
      INSERT INTO clientes (id, empresa_id, nome, cpf_cnpj) VALUES ('c1', 'e1', 'Padaria Fictícia', '1');
      INSERT INTO categorias_produto (id, empresa_id, nome, comportamento) VALUES
        ('catPeca', 'e1', 'Peças de reposição', 'VENDA_A_PARTE'), ('catMat', 'e1', 'Materiais', 'INCLUSO_NO_SERVICO');
      INSERT INTO produtos (id, empresa_id, nome, categoria_produto_id) VALUES
        ('pTubo', 'e1', 'Tubo de cobre', 'catPeca'),      -- composição 2× (material) × 1 avulso: MATERIAL (vence a categoria)
        ('pCompressor', 'e1', 'Compressor', NULL),       -- 2 linhas avulsas (peça) × 0: PECA
        ('pCapacitor', 'e1', 'Capacitor', 'catPeca'),     -- nunca usado, categoria Peças: PECA
        ('pFita', 'e1', 'Fita isolante', NULL),           -- nunca usado, sem categoria: MATERIAL
        ('pGas', 'e1', 'Gás R410A', 'catMat'),             -- 1 × 1 (empate), categoria Materiais: MATERIAL
        ('pPlaca', 'e1', 'Placa eletrônica', 'catPeca');  -- material "à parte" no orçamento 1× × 0: PECA
      INSERT INTO servicos (id, empresa_id, nome) VALUES ('s1', 'e1', 'Instalação'), ('s2', 'e1', 'Limpeza');
      INSERT INTO servico_materiais (id, servico_id, produto_id, quantidade, ordem) VALUES ('sm1', 's1', 'pTubo', 3, 0), ('sm2', 's2', 'pTubo', 1, 0), ('sm3', 's1', 'pGas', 1, 1);
      INSERT INTO orcamentos (id, empresa_id, codigo, nome, cliente_id, criado_por_id, token_publico) VALUES ('o1', 'e1', 'ORC-1', 'Orçamento 1', 'c1', 'u1', 'tok-o1');
      INSERT INTO orcamento_servicos (id, orcamento_id, servico_id, descricao, quantidade, valor_unitario, valor_total) VALUES ('os1', 'o1', 's1', 'Instalação', 1, 800, 800);
      INSERT INTO orcamento_produtos (id, orcamento_id, produto_id, descricao, quantidade, valor_unitario, valor_total) VALUES
        ('op1', 'o1', 'pTubo', 'Tubo', 1, 10, 10), ('op2', 'o1', 'pCompressor', 'Compressor', 1, 1500, 1500), ('op3', 'o1', 'pCompressor', 'Compressor', 1, 1500, 1500), ('op4', 'o1', 'pGas', 'Gás', 1, 90, 90);
      INSERT INTO orcamento_materiais (id, orcamento_id, orcamento_servico_id, produto_id, descricao, comportamento, quantidade, valor_venda_unit) VALUES
        ('om1', 'o1', 'os1', 'pPlaca', 'Placa', 'VENDA_A_PARTE', 1, 600);
      INSERT INTO configuracoes (id, empresa_id, orcamento_mostrar_materiais) VALUES ('cfg1', 'e1', false);
    `);
    for (const t of semPadrao) sql(`ALTER TABLE "${t}" ALTER COLUMN atualizado_em DROP DEFAULT`);
    rodar();
    // Depois da 1ª rodada, alguém muda o Uso no cadastro: a 2ª rodada não pode desfazer
    sql(`UPDATE produtos SET uso = 'PECA' WHERE id = 'pFita'`);
    rodar();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("preenche pela origem mais usada; empate e nunca usado vão pela categoria; sem categoria, Material", () => {
    expect(usoDe("pTubo")).toBe("MATERIAL");
    expect(usoDe("pCompressor")).toBe("PECA");
    expect(usoDe("pCapacitor")).toBe("PECA");
    expect(usoDe("pGas")).toBe("MATERIAL");
    expect(usoDe("pPlaca")).toBe("PECA");
  });

  it("rodar de novo não desfaz a escolha feita no cadastro depois da 1ª rodada", () => {
    expect(usoDe("pFita")).toBe("PECA");
  });

  it("coluna obrigatória com padrão MATERIAL: produto novo sem Uso nasce Material; valor fora do tipo é recusado", () => {
    sql(`INSERT INTO produtos (id, empresa_id, nome) VALUES ('pNovo', 'e1', 'Suporte')`);
    expect(usoDe("pNovo")).toBe("MATERIAL");
    expect(() => sql(`UPDATE produtos SET uso = 'SERVICO' WHERE id = 'pNovo'`)).toThrow();
    expect(() => sql(`UPDATE produtos SET uso = NULL WHERE id = 'pNovo'`)).toThrow();
  });

  it("mostrar materiais: só o PADRÃO vira ligado (o que já está gravado fica como está)", () => {
    expect(sql(`SELECT orcamento_mostrar_materiais FROM configuracoes WHERE id = 'cfg1'`)).toBe("f");
    expect(sql(`SELECT mostrar_materiais FROM orcamentos WHERE id = 'o1'`)).toBe("f");
    expect(sql(`SELECT column_default FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'configuracoes' AND column_name = 'orcamento_mostrar_materiais'`)).toBe("true");
    expect(sql(`SELECT column_default FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'orcamentos' AND column_name = 'mostrar_materiais'`)).toBe("true");
    // e as colunas de "valores dos materiais" continuam lá (sem uso na tela, não se apagam)
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND column_name IN ('orcamento_mostrar_valores_materiais', 'mostrar_valores_materiais')`)).toBe("2");
  });

  it("dá exatamente o que o Prisma espera: o migrate diff contra o schema.prisma fica vazio", () => {
    const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), [
      "migrate", "diff", "--from-url", urlDo(SCHEMA), "--to-schema-datamodel", "prisma/schema.prisma", "--script",
    ], { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) } });
    const comandos = diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
    expect(comandos).toEqual([]);
  });

  it("o arquivo não apaga nada e só preenche onde o Uso ainda é nulo", () => {
    const comandos = readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(comandos).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
    const updates = comandos.match(/UPDATE[\s\S]*?;/g) ?? [];
    expect(updates.length).toBe(2);
    for (const u of updates) expect(u).toMatch(/"uso" IS NULL/);
  });
});
