/**
 * O SQL de produção (prisma/sql/2027-01-11_atraso_responsavel.sql) rodado de verdade num PostgreSQL
 * descartável, POR CIMA de um banco com OS e atrasos já justificados:
 *  - acrescenta UMA coluna opcional em "ordens_servico" — nenhuma tabela, índice, chave ou enum;
 *  - as OS que já existiam continuam iguais, coluna por coluna, e a coluna nova nasce VAZIA em todas
 *    (sem preenchimento retroativo: justificativa antiga segue sem classificação e continua contando);
 *  - guarda os três valores do vocabulário do sistema;
 *  - é idempotente (roda três vezes, com dados gravados, sem erro e sem mudar nada);
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`);
 *  - o arquivo só tem o que diz: nada de DROP, UPDATE, DELETE, ALTER de coluna existente.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-atraso-responsavel
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RESPONSABILIDADES_ATRASO, atrasoPorCausaDoCliente } from "@/lib/os/prazo-execucao";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 120_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-11_atraso_responsavel.sql");
const SCHEMA = `teste_responsavel_sql_${process.pid}`;
const PRISMA = `teste_responsavel_prisma_${process.pid}`;
const OS = "ordens_servico";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção hoje: OS com atraso justificado (motivo, explicação, quem e quando) e OS sem nada */
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "ordens_servico" (
    "id" TEXT PRIMARY KEY,
    "empresa_id" TEXT NOT NULL REFERENCES "empresas" ("id") ON DELETE CASCADE,
    "numero" TEXT NOT NULL,
    "prazo_execucao" DATE,
    "data_conclusao" TIMESTAMP(3),
    "atraso_justificado_motivo" TEXT,
    "atraso_justificado_obs" TEXT,
    "atraso_justificado_por_id" TEXT REFERENCES "usuarios" ("id"),
    "atraso_justificado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL
  );
  CREATE INDEX "ordens_servico_empresa_id_prazo_execucao_idx" ON "ordens_servico" ("empresa_id", "prazo_execucao");
  CREATE TABLE "os_historico" ("id" TEXT PRIMARY KEY, "ordem_servico_id" TEXT NOT NULL REFERENCES "ordens_servico" ("id"), "acao" TEXT NOT NULL);
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total'), ('e2', 'Outra');
  INSERT INTO "usuarios" VALUES ('u1', 'Gabi Gestora');
  INSERT INTO "ordens_servico" ("id", "empresa_id", "numero", "prazo_execucao", "data_conclusao", "atraso_justificado_motivo", "atraso_justificado_obs", "atraso_justificado_por_id", "atraso_justificado_em", "criado_em", "atualizado_em") VALUES
    ('os1', 'e1', 'OS-001', '2026-11-10', '2026-11-13 10:00:00', 'CLIENTE_AUSENTE', 'Ninguém na recepção', 'u1', '2026-11-14 09:00:00', '2026-11-01 08:00:00', '2026-11-14 09:00:00'),
    ('os2', 'e1', 'OS-002', '2026-11-12', '2026-11-20 10:00:00', 'OUTRO', 'Equipe remanejada', 'u1', '2026-11-21 09:00:00', '2026-11-02 08:00:00', '2026-11-21 09:00:00'),
    ('os3', 'e2', 'OS-003', '2026-11-12', NULL, NULL, NULL, NULL, NULL, '2026-11-03 08:00:00', '2026-11-03 08:00:00');
  INSERT INTO "os_historico" VALUES ('h1', 'os1', 'Atraso justificado');
`;

const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (tabela: string) => sql(`SELECT replace(indexdef, '${SCHEMA}.', '') FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${SCHEMA}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${SCHEMA}' AND conrelid = '${SCHEMA}.${tabela}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`).split(",");
const tipos = () => sql(`SELECT coalesce(string_agg(typname, ',' ORDER BY typname), '') FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typtype = 'e'`);
const linhas = (tabela: string) => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM "${tabela}" t`);
const retrato = (lista: string[]) => lista.map((t) => `${t}\n${colunas(SCHEMA, t)}\n${indices(t)}\n${chaves(t)}\n${linhas(t)}`).join("\n=====\n");
const ANTIGAS = `"id", "empresa_id", "numero", "prazo_execucao", "data_conclusao", "atraso_justificado_motivo", "atraso_justificado_obs", "atraso_justificado_por_id", "atraso_justificado_em", "criado_em", "atualizado_em"`;
const osAntiga = () => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM (SELECT ${ANTIGAS} FROM "${OS}") t`);

describe.skipIf(!URL)("SQL de produção: de quem foi a causa do atraso (PostgreSQL real)", () => {
  const INTOCADAS = ["empresas", "usuarios", "os_historico"];
  let antes = { tabelas: [] as string[], tipos: "", intocadas: "", os: "", colunas: [] as string[], indices: "", chaves: "" };

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    antes = { tabelas: tabelas(), tipos: tipos(), intocadas: retrato(INTOCADAS), os: osAntiga(), colunas: colunas(SCHEMA, OS).split("\n"), indices: indices(OS), chaves: chaves(OS) };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("acrescenta UMA coluna opcional em \"ordens_servico\" e mais nada: nenhuma tabela, índice, chave ou enum", () => {
    expect(tabelas()).toEqual(antes.tabelas);
    expect(tipos()).toBe(antes.tipos);
    expect(retrato(INTOCADAS)).toBe(antes.intocadas);
    const agora = colunas(SCHEMA, OS).split("\n");
    expect(agora.filter((c) => !antes.colunas.includes(c))).toEqual(["atraso_responsavel text text YES -"]);
    expect(antes.colunas.filter((c) => !agora.includes(c))).toEqual([]); // nada saiu nem mudou de tipo
    expect(indices(OS)).toBe(antes.indices);
    expect(chaves(OS)).toBe(antes.chaves);
  });

  it("as OS que já existiam continuam EXATAMENTE como estavam, e a coluna nova nasce vazia em todas", () => {
    expect(osAntiga()).toBe(antes.os);
    expect(sql(`SELECT count(*) FROM "${OS}"`)).toBe("3");
    expect(sql(`SELECT count(*) FROM "${OS}" WHERE "atraso_responsavel" IS NOT NULL`)).toBe("0");
    // sem classificação, o atraso justificado continua contando no relatório do cliente (nada mudou)
    expect(atrasoPorCausaDoCliente({ atrasoJustificadoMotivo: "CLIENTE_AUSENTE", atrasoResponsavel: null })).toBe(false);
  });

  it("guarda os três valores do vocabulário — e só a causa do cliente pausa o SLA", () => {
    for (const r of RESPONSABILIDADES_ATRASO) {
      sql(`UPDATE "${OS}" SET "atraso_responsavel" = '${r}' WHERE "id" = 'os1'`);
      expect(sql(`SELECT "atraso_responsavel" FROM "${OS}" WHERE "id" = 'os1'`)).toBe(r);
      expect(atrasoPorCausaDoCliente({ atrasoJustificadoMotivo: "CLIENTE_AUSENTE", atrasoResponsavel: r })).toBe(r === "CLIENTE");
    }
    sql(`UPDATE "${OS}" SET "atraso_responsavel" = 'CLIENTE' WHERE "id" = 'os1'`);
    expect(sql(`SELECT coalesce("atraso_responsavel", 'vazio') FROM "${OS}" WHERE "id" = 'os2'`)).toBe("vazio");
  });

  it("é idempotente: roda de novo (três vezes), com a causa gravada, sem erro e sem mudar nada", () => {
    const antesDeRodar = retrato(tabelas());
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    expect(retrato(tabelas())).toBe(antesDeRodar);
    expect(sql(`SELECT "atraso_responsavel" FROM "${OS}" WHERE "id" = 'os1'`)).toBe("CLIENTE");
  });

  it("dá exatamente o que o Prisma espera (comparado com `prisma db push`)", () => {
    execFileSync("psql", [URL!, "-q", "-c", `CREATE SCHEMA ${PRISMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}` }, stdio: "pipe",
    });
    const coluna = (schema: string) => colunas(schema, OS).split("\n").filter((l) => l.startsWith("atraso_responsavel "));
    expect(coluna(SCHEMA)).toEqual(coluna(PRISMA));
    expect(coluna(SCHEMA)).toHaveLength(1);
    // e é do mesmo tipo do motivo ao lado: texto livre validado no código, não enum do banco
    const tipoDe = (c: string) => colunas(PRISMA, OS).split("\n").find((l) => l.startsWith(`${c} `))!.split(" ").slice(1).join(" ");
    expect(tipoDe("atraso_responsavel")).toBe(tipoDe("atraso_justificado_motivo"));
  });

  it("o arquivo só tem o que diz: um ADD COLUMN IF NOT EXISTS — nada de apagar, alterar ou preencher", () => {
    const comandos = readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--") && l.trim()).join("\n");
    expect(comandos).toBe(`ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "atraso_responsavel" TEXT;`);
  });
});
