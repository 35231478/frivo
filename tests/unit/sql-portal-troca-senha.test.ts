/**
 * Portal do cliente, senha provisória segura: o SQL de produção (prisma/sql/2027-02-09_portal_troca_senha.sql)
 * rodado de verdade num PostgreSQL. Produção simulada = o schema de hoje SEM a coluna, com contatos fictícios
 * (um com a senha antiga ainda em texto na coluna obsoleta). O arquivo roda DUAS vezes e:
 *  - cria `contatos_cliente.trocar_senha` NOT NULL, padrão false: quem já tem acesso continua entrando direto;
 *  - rodar de novo não desfaz uma marca gravada depois;
 *  - NÃO toca na coluna antiga `senha_provisoria` (nem apaga nem zera: a limpeza fica para depois);
 *  - deixa o banco exatamente como o Prisma espera (migrate diff vazio).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-portal-troca-senha
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-09_portal_troca_senha.sql");
const SCHEMA = `teste_portal_troca_${process.pid}`;
const urlDo = (schema: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}`;
function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["-f", ARQUIVO]);

describe.skipIf(!URL)("SQL de produção: troca de senha no 1º acesso do portal — PostgreSQL real", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) }, stdio: "pipe",
    });
    sql(`ALTER TABLE contatos_cliente DROP COLUMN trocar_senha;`); // produção HOJE: sem a coluna
    sql(`
      INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e1', 'Refrigeração Teste (fictícia)', '45.723.174/0001-10', 'e@ficticio.test', now());
      INSERT INTO clientes (id, empresa_id, nome, cpf_cnpj, atualizado_em) VALUES ('c1', 'e1', 'Clínica Fictícia', '11.111.111/0001-11', now());
      INSERT INTO contatos_cliente (id, empresa_id, cliente_id, nome, email, senha, senha_provisoria, atualizado_em) VALUES
        ('ctAntigo', 'e1', 'c1', 'Rui', 'rui@ficticio.test', '$2a$04$hash', 'Antiga-2026', now()),
        ('ctSem', 'e1', 'c1', 'Lia', 'lia@ficticio.test', NULL, NULL, now());
    `);
    rodar();
    sql(`UPDATE contatos_cliente SET trocar_senha = true WHERE id = 'ctSem'`); // o sistema marcou depois da 1ª rodada
    rodar();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("quem já tem acesso não passa a ser obrigado a trocar; o contato novo nasce sem a marca", () => {
    expect(sql(`SELECT trocar_senha FROM contatos_cliente WHERE id = 'ctAntigo'`)).toBe("f");
    sql(`INSERT INTO contatos_cliente (id, empresa_id, cliente_id, nome, atualizado_em) VALUES ('ctNovo', 'e1', 'c1', 'Ana', now())`);
    expect(sql(`SELECT trocar_senha FROM contatos_cliente WHERE id = 'ctNovo'`)).toBe("f");
  });
  it("rodar de novo não desfaz a marca gravada depois", () => {
    expect(sql(`SELECT trocar_senha FROM contatos_cliente WHERE id = 'ctSem'`)).toBe("t");
  });
  it("não toca na coluna antiga: o hash e o texto antigo seguem como estavam (a limpeza é outro passo)", () => {
    expect(sql(`SELECT senha || '|' || senha_provisoria FROM contatos_cliente WHERE id = 'ctAntigo'`)).toBe("$2a$04$hash|Antiga-2026");
  });
  it("não aceita nulo", () => {
    expect(() => sql(`UPDATE contatos_cliente SET trocar_senha = NULL WHERE id = 'ctAntigo'`)).toThrow();
  });
  it("dá exatamente o que o Prisma espera: o migrate diff contra o schema.prisma fica vazio", () => {
    const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), [
      "migrate", "diff", "--from-url", urlDo(SCHEMA), "--to-schema-datamodel", "prisma/schema.prisma", "--script",
    ], { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) } });
    expect(diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"))).toEqual([]);
  });
});
