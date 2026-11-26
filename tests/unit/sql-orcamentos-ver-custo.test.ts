/**
 * O SQL OPCIONAL da permissão "Orçamentos › Ver custo e margem" (prisma/sql/2027-01-26_orcamentos_ver_custo.sql)
 * rodado de verdade num PostgreSQL descartável:
 *  - só os perfis do tipo ADMINISTRADOR ganham orcamentos.verCusto = true;
 *  - perfil de outro tipo (Financeiro, Personalizado…) fica como estava: sem a permissão;
 *  - quem já tem a chave (true OU false) não é tocado: a escolha feita na tela vale;
 *  - perfil sem o módulo "orcamentos" (ou com JSON estranho) não é tocado;
 *  - idempotente: roda três vezes e dá o mesmo resultado.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-orcamentos-ver-custo
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 60_000 });
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2027-01-26_orcamentos_ver_custo.sql");
const SCHEMA = `teste_ver_custo_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["-f", ARQUIVO]);
const permissao = (id: string) => sql(`SELECT permissoes::jsonb -> 'orcamentos' ->> 'verCusto' FROM perfis_acesso WHERE id = '${id}'`);
const tudo = () => sql("SELECT id || '=' || permissoes::text FROM perfis_acesso ORDER BY id");

describe.skipIf(!URL)("SQL opcional — orcamentos.verCusto nos perfis Administrador", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`CREATE TYPE "TipoPerfilAcesso" AS ENUM ('ADMINISTRADOR','SUPERVISOR','FINANCEIRO','TECNICO','AUXILIAR','PERSONALIZADO');
         CREATE TABLE perfis_acesso (id text PRIMARY KEY, empresa_id text NOT NULL, nome text NOT NULL, tipo "TipoPerfilAcesso" NOT NULL DEFAULT 'PERSONALIZADO', permissoes jsonb NOT NULL);
         INSERT INTO perfis_acesso (id, empresa_id, nome, tipo, permissoes) VALUES
           ('adm', 'e1', 'Administrador', 'ADMINISTRADOR', '{"orcamentos": {"visualizar": true, "editar": true}}'),
           ('adm-outra', 'e2', 'Administrador', 'ADMINISTRADOR', '{"orcamentos": {"visualizar": true}}'),
           ('adm-negado', 'e1', 'Adm sem custo', 'ADMINISTRADOR', '{"orcamentos": {"visualizar": true, "verCusto": false}}'),
           ('adm-sem-orc', 'e1', 'Adm sem orçamentos', 'ADMINISTRADOR', '{"ordens": {"visualizar": true}}'),
           ('adm-estranho', 'e1', 'Adm JSON estranho', 'ADMINISTRADOR', '[]'),
           ('fin', 'e1', 'Financeiro', 'FINANCEIRO', '{"orcamentos": {"visualizar": true, "editar": true}}'),
           ('pers', 'e1', 'Vendas', 'PERSONALIZADO', '{"orcamentos": {"visualizar": true, "criar": true}}');`);
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("só Administrador ganha; o resto e as escolhas já gravadas ficam como estavam; idempotente", () => {
    rodar();
    expect([permissao("adm"), permissao("adm-outra")]).toEqual(["true", "true"]);
    expect(sql("SELECT permissoes::text FROM perfis_acesso WHERE id = 'adm'")).toBe('{"orcamentos": {"editar": true, "verCusto": true, "visualizar": true}}');
    expect(permissao("adm-negado")).toBe("false"); // a escolha da tela vale
    expect([permissao("fin"), permissao("pers")]).toEqual(["", ""]); // sem a chave = sem a permissão
    expect(sql("SELECT permissoes::text FROM perfis_acesso WHERE id = 'adm-sem-orc'")).toBe('{"ordens": {"visualizar": true}}');
    expect(sql("SELECT permissoes::text FROM perfis_acesso WHERE id = 'adm-estranho'")).toBe("[]");
    const depois1 = tudo();
    rodar(); rodar();
    expect(tudo()).toBe(depois1);
  });
});
