/**
 * "Troca de senha no 1º acesso": o SQL de produção (prisma/sql/2027-02-08_troca_senha_primeiro_acesso.sql) rodado de
 * verdade num PostgreSQL. Produção simulada = o schema de hoje SEM a coluna, com usuários fictícios. O arquivo roda
 * DUAS vezes e:
 *  - cria `usuarios.trocar_senha` NOT NULL, padrão false: NENHUM usuário que já existe passa a ser obrigado a trocar;
 *  - rodar de novo não desfaz uma marca gravada depois (a 2ª rodada não mexe em nada);
 *  - deixa o banco exatamente como o Prisma espera (migrate diff vazio) e não apaga nem atualiza nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-troca-senha
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-02-08_troca_senha_primeiro_acesso.sql");
const SCHEMA = `teste_troca_senha_${process.pid}`;
const urlDo = (schema: string) => `${URL}${URL!.includes("?") ? "&" : "?"}schema=${schema}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["-f", ARQUIVO]);

describe.skipIf(!URL)("SQL de produção: troca de senha no 1º acesso — PostgreSQL real", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) }, stdio: "pipe",
    });
    // Produção HOJE: sem a coluna
    sql(`ALTER TABLE usuarios DROP COLUMN trocar_senha;`);
    sql(`
      INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e1', 'Refrigeração Teste (fictícia)', '45.723.174/0001-10', 'e@ficticio.test', now());
      INSERT INTO usuarios (id, empresa_id, nome, email, senha, role, atualizado_em) VALUES
        ('uAdmin', 'e1', 'Ana', 'ana@ficticio.test', 'x', 'ADMIN', now()),
        ('uTec', 'e1', 'Diego', 'diego@ficticio.test', 'x', 'TECNICO', now());
    `);
    rodar();
    // Depois da 1ª rodada, o gestor redefine a senha do técnico (o sistema marca): a 2ª rodada não pode desfazer
    sql(`UPDATE usuarios SET trocar_senha = true WHERE id = 'uTec'`);
    rodar();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("quem já existe não passa a ser obrigado a trocar; o novo nasce sem a marca", () => {
    expect(sql(`SELECT trocar_senha FROM usuarios WHERE id = 'uAdmin'`)).toBe("f");
    sql(`INSERT INTO usuarios (id, empresa_id, nome, email, senha, atualizado_em) VALUES ('uNovo', 'e1', 'Caio', 'caio@ficticio.test', 'x', now())`);
    expect(sql(`SELECT trocar_senha FROM usuarios WHERE id = 'uNovo'`)).toBe("f");
  });

  it("rodar de novo não desfaz a marca gravada depois", () => {
    expect(sql(`SELECT trocar_senha FROM usuarios WHERE id = 'uTec'`)).toBe("t");
  });

  it("não aceita nulo", () => {
    expect(() => sql(`UPDATE usuarios SET trocar_senha = NULL WHERE id = 'uAdmin'`)).toThrow();
  });

  it("dá exatamente o que o Prisma espera: o migrate diff contra o schema.prisma fica vazio", () => {
    const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), [
      "migrate", "diff", "--from-url", urlDo(SCHEMA), "--to-schema-datamodel", "prisma/schema.prisma", "--script",
    ], { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlDo(SCHEMA) } });
    expect(diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"))).toEqual([]);
  });

  it("o arquivo só acrescenta a coluna: nada de apagar nem de atualizar usuários", () => {
    const comandos = readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(comandos).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b/i);
    expect(comandos).toMatch(/ADD COLUMN IF NOT EXISTS "trocar_senha" BOOLEAN NOT NULL DEFAULT false/);
  });
});
