/**
 * DESEMPENHO (PR 2) — o SQL de produção (prisma/sql/2027-01-01_desempenho_fechamento.sql) rodado de
 * verdade num PostgreSQL descartável, POR CIMA do banco como está em produção (o SQL do PR 1 já
 * aplicado, com a configuração e um item de revisão gravados):
 *  - cria DUAS tabelas (o fechamento e as linhas da folha) — e mais nada;
 *  - nenhuma tabela existente ganha, perde ou muda coluna, linha, índice ou chave;
 *  - um mês tem no máximo um fechamento por versão; os valores têm centavos;
 *  - apagar o colaborador ou o usuário NÃO apaga a folha (o nome e o valor ficam gravados);
 *  - é idempotente (roda três vezes, com fechamento gravado e reaberto, sem erro e sem mudar nada);
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-desempenho-fechamento
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 60_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ANTERIOR = path.join(RAIZ, "prisma/sql/2026-12-31_desempenho.sql");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-01_desempenho_fechamento.sql");
const SCHEMA = `teste_desemp_fech_${process.pid}`;
const PRISMA = `teste_desemp_fech_prisma_${process.pid}`;
const NOVAS = ["desempenho_fechamento_linhas", "desempenho_fechamentos"];
const F = "desempenho_fechamentos", L = "desempenho_fechamento_linhas";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção hoje: o que os dois arquivos referenciam, e o PR 1 já em uso */
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "tipos_os" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL);
  CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY, "ordem_servico_id" TEXT NOT NULL, "titulo" TEXT NOT NULL);
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total'), ('e2', 'Outra');
  INSERT INTO "usuarios" VALUES ('u1', 'Ana'), ('u2', 'Beto');
  INSERT INTO "tecnicos" VALUES ('t1', 'e1', 'João'), ('t2', 'e1', 'Maria');
  INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1');
`;
const EM_USO = `
  INSERT INTO "desempenho_config" ("id", "empresa_id", "retorno_dias", "atualizado_em") VALUES ('cfg1', 'e1', 45, now());
  INSERT INTO "desempenho_perfis" ("id", "empresa_id", "nome", "atualizado_em") VALUES ('p1', 'e1', 'Preventiva', now());
  INSERT INTO "desempenho_participantes" ("id", "empresa_id", "tecnico_id", "perfil_id") VALUES ('pa1', 'e1', 't1', 'p1');
  INSERT INTO "desempenho_penalidades" ("id", "empresa_id", "tecnico_id", "tipo", "chave", "ordem_servico_id", "data_fato", "competencia", "situacao", "motivo", "atualizado_em")
    VALUES ('pe1', 'e1', 't1', 'RESSALVA', 'ACEITE:x:t1', 'os1', '2026-11-10 12:00', '2026-11', 'CONTA', 'Defeito do serviço', '2026-11-11 10:00');
`;
const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-') || ' ' || coalesce(numeric_precision::text, '-') || ',' || coalesce(numeric_scale::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`).split(",");
const linhas = (tabela: string) => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM "${tabela}" t`);
const retrato = (lista: string[]) => lista.map((t) => `${t}\n${colunas(SCHEMA, t)}\n${indices(SCHEMA, t)}\n${chaves(SCHEMA, t)}\n${linhas(t)}`).join("\n=====\n");
const fechamento = (id: string, empresa: string, mes: string, versao: number, extra = "") =>
  sql(`INSERT INTO "${F}" ("id", "empresa_id", "competencia", "versao", "painel", "premios", "total_bonus", "fechado_por_id", "fechado_por_nome", "fechado_em", "atualizado_em"${extra ? ', "situacao"' : ""})
    VALUES ('${id}', '${empresa}', '${mes}', ${versao}, '{"grupos":[]}', '[]', 550.35, 'u1', 'Ana', '2026-12-02 15:00', now()${extra ? `, '${extra}'` : ""})`);

describe.skipIf(!URL)("SQL de produção: Desempenho PR 2 — fechamento e folha de bônus (PostgreSQL real)", () => {
  let antes = { tabelas: [] as string[], existentes: "" };

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    psql(["-f", ANTERIOR]);
    sql(EM_USO);
    antes = { tabelas: tabelas(), existentes: retrato(tabelas()) };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria DUAS tabelas — e mais nada: nenhuma tabela existente (nem as do PR 1) ganha, perde ou muda coluna, linha, índice ou chave", () => {
    expect(tabelas()).toEqual([...antes.tabelas, ...NOVAS].sort());
    expect(retrato(antes.tabelas)).toBe(antes.existentes);
    for (const t of NOVAS) expect(sql(`SELECT count(*) FROM "${t}"`), t).toBe("0"); // nascem vazias
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typtype = 'e'`)).toBe("0"); // sem enum
  });

  it("padrões: versão 1, situação 'FECHADO', total e valor zero; os valores guardam centavos (12,2) e o escore uma casa (5,1)", () => {
    sql(`INSERT INTO "${F}" ("id", "empresa_id", "competencia", "painel", "premios", "fechado_por_nome", "fechado_em", "atualizado_em") VALUES ('fPadrao', 'e2', '2026-10', '{}', '[]', 'Beto', now(), now())`);
    expect(sql(`SELECT "versao" || '|' || "situacao" || '|' || "total_bonus" || '|' || coalesce("reaberto_em"::text, '-') || '|' || coalesce("reabertura_motivo", '-') FROM "${F}" WHERE "id" = 'fPadrao'`)).toBe("1|FECHADO|0.00|-|-");
    sql(`INSERT INTO "${L}" ("id", "fechamento_id", "empresa_id", "nome", "perfil") VALUES ('lPadrao', 'fPadrao', 'e2', 'Sem medição', 'Preventiva')`);
    expect(sql(`SELECT "valor" || '|' || coalesce("escore"::text, 'vazio') || '|' || coalesce("faixa", 'vazia') || '|' || coalesce("posicao"::text, 'vazia') FROM "${L}" WHERE "id" = 'lPadrao'`)).toBe("0.00|vazio|vazia|vazia");
    sql(`UPDATE "${L}" SET "valor" = 1234567.899, "escore" = 87.46 WHERE "id" = 'lPadrao'`);
    expect(sql(`SELECT "valor" || '|' || "escore" FROM "${L}" WHERE "id" = 'lPadrao'`)).toBe("1234567.90|87.5");
    const col = (tabela: string, nome: string) => colunas(SCHEMA, tabela).split("\n").find((l) => l.startsWith(`${nome} `));
    expect(col(F, "total_bonus")).toBe("total_bonus numeric numeric NO 0 - 12,2");
    expect(col(L, "valor")).toBe("valor numeric numeric NO 0 - 12,2");
    expect(col(L, "escore")).toBe("escore numeric numeric YES - - 5,1");
    expect(col(F, "painel")).toBe("painel jsonb jsonb NO - - -,-");
    sql(`DELETE FROM "${F}" WHERE "id" = 'fPadrao'`);
  });

  it("um mês tem no máximo UM fechamento por versão (por empresa); reabrir e fechar de novo é a versão seguinte", () => {
    fechamento("f1", "e1", "2026-11", 1);
    expect(() => fechamento("fDup", "e1", "2026-11", 1)).toThrow(/desempenho_fechamentos_empresa_id_competencia_versao_key/);
    sql(`UPDATE "${F}" SET "situacao" = 'REABERTO', "reaberto_por_id" = 'u2', "reaberto_por_nome" = 'Beto', "reaberto_em" = '2026-12-03 10:00', "reabertura_motivo" = 'Faltou revisar' WHERE "id" = 'f1'`);
    fechamento("f2", "e1", "2026-11", 2);       // a versão seguinte do mesmo mês
    fechamento("f3", "e1", "2026-12", 1);       // outro mês
    fechamento("f4", "e2", "2026-11", 1);       // o mesmo mês em OUTRA empresa
    expect(sql(`SELECT string_agg("empresa_id" || ':' || "competencia" || ':' || "versao" || ':' || "situacao", ',' ORDER BY "id") FROM "${F}"`)).toBe("e1:2026-11:1:REABERTO,e1:2026-11:2:FECHADO,e1:2026-12:1:FECHADO,e2:2026-11:1:FECHADO");
    expect(() => sql(`INSERT INTO "${L}" ("id", "fechamento_id", "empresa_id", "nome", "perfil") VALUES ('lX', 'nao-existe', 'e1', 'X', 'P')`)).toThrow(/desempenho_fechamento_linhas_fechamento_id_fkey/);
    expect(() => sql(`INSERT INTO "${F}" ("id", "empresa_id", "competencia", "painel", "premios", "fechado_em", "atualizado_em") VALUES ('fSemNome', 'e1', '2027-01', '{}', '[]', now(), now())`)).toThrow(/fechado_por_nome/);
    sql(`INSERT INTO "${L}" ("id", "fechamento_id", "empresa_id", "tecnico_id", "nome", "perfil", "posicao", "escore", "faixa", "valor") VALUES
      ('l1', 'f1', 'e1', 't1', 'João', 'Preventiva', 1, 95.0, 'Ouro', 350.00), ('l2', 'f1', 'e1', 't2', 'Maria', 'Preventiva', 2, 85.0, 'Prata', 200.35),
      ('l3', 'f2', 'e1', 't1', 'João', 'Preventiva', 1, 95.0, 'Ouro', 350.00)`);
  });

  it("é IDEMPOTENTE: rodar de novo (três vezes), com fechamento gravado e reaberto, não dá erro e não muda nada", () => {
    const tudo = () => [tabelas().join(","), retrato(tabelas())].join("\n#####\n");
    const depois = tudo();
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO]);
    expect(tudo()).toBe(depois);
    expect(sql(`SELECT "situacao" || '|' || "reaberto_por_nome" || '|' || "reabertura_motivo" || '|' || "total_bonus" FROM "${F}" WHERE "id" = 'f1'`)).toBe("REABERTO|Beto|Faltou revisar|550.35");
    expect(sql(`SELECT string_agg("id" || ':' || "valor", ',' ORDER BY "id") FROM "${L}"`)).toBe("l1:350.00,l2:200.35,l3:350.00");
    for (const t of NOVAS) expect(chaves(SCHEMA, t).split("\n").length, t).toBe(new Set(chaves(SCHEMA, t).split("\n")).size); // nenhuma chave em dobro
    // O arquivo do PR 1 também pode rodar de novo por cima, sem mexer no PR 2
    psql(["-f", ANTERIOR]);
    expect(tudo()).toBe(depois);
  });

  it("apagar o colaborador ou o usuário NÃO apaga a folha: só esvazia a ligação — o nome e o valor ficam gravados", () => {
    sql(`DELETE FROM "desempenho_penalidades" WHERE "tecnico_id" = 't2'; DELETE FROM "tecnicos" WHERE "id" = 't2'; DELETE FROM "usuarios" WHERE "id" IN ('u1', 'u2')`);
    expect(sql(`SELECT coalesce("tecnico_id", 'vazio') || '|' || "nome" || '|' || "valor" || '|' || "faixa" FROM "${L}" WHERE "id" = 'l2'`)).toBe("vazio|Maria|200.35|Prata");
    expect(sql(`SELECT coalesce("fechado_por_id", 'vazio') || '|' || "fechado_por_nome" || '|' || coalesce("reaberto_por_id", 'vazio') || '|' || "reaberto_por_nome" FROM "${F}" WHERE "id" = 'f1'`)).toBe("vazio|Ana|vazio|Beto");
    expect(sql(`SELECT count(*) FROM "${L}"`)).toBe("3");
  });

  it("apagar o fechamento leva as linhas dele; apagar a empresa leva tudo que é dela — e só dela", () => {
    sql(`DELETE FROM "${F}" WHERE "id" = 'f2'`);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "${L}"`)).toBe("l1,l2");
    sql(`DELETE FROM "empresas" WHERE "id" = 'e1'`);
    expect(sql(`SELECT (SELECT count(*) FROM "${F}" WHERE "empresa_id" = 'e1') || '|' || (SELECT count(*) FROM "${L}") || '|' || (SELECT string_agg("id", ',') FROM "${F}")`)).toBe("0|0|f4");
  });

  it("o arquivo só ACRESCENTA: duas tabelas, índices e chaves, cada um com a sua guarda — sem coluna em tabela existente, sem apagar, alterar, preencher ou criar enum", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(fonte).not.toMatch(/CREATE TYPE|ALTER TYPE|DROP |TRUNCATE|DELETE FROM|UPDATE "|ALTER COLUMN|RENAME|INSERT |ADD COLUMN/);
    expect(fonte.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(fonte.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
    expect(fonte.match(/CREATE (UNIQUE )?INDEX/g)).toHaveLength(5);
    expect(fonte.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g)).toHaveLength(5);
    expect(fonte.match(/ADD CONSTRAINT/g)).toHaveLength(6);
    expect(fonte.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = '[a-z_]+_fkey' AND conrelid = tabela\)/g)).toHaveLength(6);
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]))].sort()).toEqual(NOVAS); // só mexe nas próprias tabelas
    expect([...fonte.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(NOVAS);
    expect(fonte).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/m);
    expect(fonte).not.toMatch(/imposto|encargo/i);
  });

  it("dá EXATAMENTE o que o Prisma espera nas duas tabelas (comparado com `prisma db push`)", () => {
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    for (const t of NOVAS) {
      expect(colunas(SCHEMA, t), `colunas de ${t}`).toBe(colunas(PRISMA, t));
      expect(indices(SCHEMA, t), `índices de ${t}`).toBe(indices(PRISMA, t));
      expect(chaves(SCHEMA, t), `chaves de ${t}`).toBe(chaves(PRISMA, t));
    }
  }, 180_000);
});
