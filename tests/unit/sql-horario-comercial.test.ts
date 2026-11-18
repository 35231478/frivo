/**
 * O SQL de produção (prisma/sql/2027-01-10_horario_comercial_empresa.sql) rodado de verdade num
 * PostgreSQL descartável, POR CIMA de um banco com empresas já configuradas:
 *  - acrescenta UMA coluna opcional em "configuracoes" — nenhuma tabela, índice, chave ou enum;
 *  - as configurações que já existiam continuam iguais, coluna por coluna, e a coluna nova nasce
 *    VAZIA em todas (sem preenchimento retroativo: vazio = segunda a sexta, 8h às 18h, o que valia);
 *  - guarda a jornada no formato que o sistema lê;
 *  - é idempotente (roda três vezes, com dados gravados, sem erro e sem mudar nada);
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`);
 *  - o arquivo só tem o que diz: nada de DROP, UPDATE, DELETE, ALTER de coluna existente.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-horario-comercial
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JORNADA_PADRAO, jornadaDe, lerJornada } from "@/lib/atendimento/prazo";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 120_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-10_horario_comercial_empresa.sql");
const SCHEMA = `teste_horario_sql_${process.pid}`;
const PRISMA = `teste_horario_prisma_${process.pid}`;
const CONFIG = "configuracoes";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção hoje: a linha de configuração de cada empresa, com os JSON que já existem */
const BASE = `
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "configuracoes" (
    "id" TEXT PRIMARY KEY,
    "empresa_id" TEXT NOT NULL UNIQUE REFERENCES "empresas" ("id") ON DELETE CASCADE,
    "app_avisar_cliente" BOOLEAN NOT NULL DEFAULT true,
    "qr_config" JSONB,
    "relatorio_os_config" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL
  );
  CREATE TABLE "contratos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "numero" TEXT NOT NULL);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "atendimento_comparecer_ate" TIMESTAMP(3), "atendimento_resolver_ate" TIMESTAMP(3));
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total'), ('e2', 'Outra'), ('e3', 'Sem configuração');
  INSERT INTO "configuracoes" ("id", "empresa_id", "app_avisar_cliente", "qr_config", "relatorio_os_config", "criado_em", "atualizado_em") VALUES
    ('cf1', 'e1', true, '{"botaoChamado": true}', '{"fotos": "todas"}', '2026-01-10 12:00:00', '2026-11-01 12:00:00'),
    ('cf2', 'e2', false, NULL, NULL, '2026-02-10 12:00:00', '2026-11-02 12:00:00');
  INSERT INTO "contratos" VALUES ('ct1', 'e1', 'CT-1');
  INSERT INTO "ordens_servico" VALUES ('os1', 'e1', '2026-11-18 17:00:00', '2026-11-19 13:00:00'), ('os2', 'e1', NULL, NULL);
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
const ANTIGAS = `"id", "empresa_id", "app_avisar_cliente", "qr_config", "relatorio_os_config", "criado_em", "atualizado_em"`;
const configAntiga = () => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM (SELECT ${ANTIGAS} FROM "${CONFIG}") t`);

describe.skipIf(!URL)("SQL de produção: horário comercial por empresa (PostgreSQL real)", () => {
  const INTOCADAS = ["empresas", "contratos", "ordens_servico"];
  let antes = { tabelas: [] as string[], tipos: "", intocadas: "", config: "", colunas: [] as string[], indices: "", chaves: "" };

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    antes = { tabelas: tabelas(), tipos: tipos(), intocadas: retrato(INTOCADAS), config: configAntiga(), colunas: colunas(SCHEMA, CONFIG).split("\n"), indices: indices(CONFIG), chaves: chaves(CONFIG) };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("acrescenta UMA coluna opcional em \"configuracoes\" e mais nada: nenhuma tabela, índice, chave ou enum", () => {
    expect(tabelas()).toEqual(antes.tabelas);
    expect(tipos()).toBe(antes.tipos);
    expect(retrato(INTOCADAS)).toBe(antes.intocadas);
    const agora = colunas(SCHEMA, CONFIG).split("\n");
    expect(agora.filter((c) => !antes.colunas.includes(c))).toEqual(["horario_comercial jsonb jsonb YES -"]);
    expect(antes.colunas.filter((c) => !agora.includes(c))).toEqual([]); // nada saiu nem mudou de tipo
    expect(indices(CONFIG)).toBe(antes.indices);
    expect(chaves(CONFIG)).toBe(antes.chaves);
  });

  it("as configurações que já existiam continuam EXATAMENTE como estavam, e a coluna nova nasce vazia em todas", () => {
    expect(configAntiga()).toBe(antes.config);
    expect(sql(`SELECT count(*) FROM "${CONFIG}"`)).toBe("2"); // não cria linha para a empresa que não tinha
    expect(sql(`SELECT count(*) FROM "${CONFIG}" WHERE "horario_comercial" IS NOT NULL`)).toBe("0");
    // vazio é o que valia antes: o sistema lê NULL como segunda a sexta, das 8h às 18h
    expect(lerJornada(null)).toBe(JORNADA_PADRAO);
    // e os prazos já gravados nas OS não são tocados
    expect(sql(`SELECT "atendimento_comparecer_ate" || '|' || "atendimento_resolver_ate" FROM "ordens_servico" WHERE "id" = 'os1'`)).toBe("2026-11-18 17:00:00|2026-11-19 13:00:00");
  });

  it("guarda a jornada no formato que o sistema lê, por empresa", () => {
    const comSabado = { dias: [...[1, 2, 3, 4, 5].map((dia) => ({ dia, inicio: "08:00", fim: "18:00" })), { dia: 6, inicio: "08:00", fim: "12:00" }] };
    sql(`UPDATE "${CONFIG}" SET "horario_comercial" = '${JSON.stringify(comSabado)}' WHERE "empresa_id" = 'e1'`);
    const lido = JSON.parse(sql(`SELECT "horario_comercial"::text FROM "${CONFIG}" WHERE "empresa_id" = 'e1'`));
    expect(lido).toEqual(comSabado);
    expect(lerJornada(lido)).toEqual(jornadaDe(comSabado));
    expect(sql(`SELECT coalesce("horario_comercial"::text, 'vazio') FROM "${CONFIG}" WHERE "empresa_id" = 'e2'`)).toBe("vazio");
  });

  it("é idempotente: roda de novo, com a jornada gravada, sem erro e sem mudar nada", () => {
    const antesDeRodar = retrato(tabelas());
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    expect(retrato(tabelas())).toBe(antesDeRodar);
    expect(sql(`SELECT ("horario_comercial" -> 'dias' -> 5 ->> 'fim') FROM "${CONFIG}" WHERE "empresa_id" = 'e1'`)).toBe("12:00");
  });

  it("dá exatamente o que o Prisma espera (comparado com `prisma db push`)", () => {
    execFileSync("psql", [URL!, "-q", "-c", `CREATE SCHEMA ${PRISMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}` }, stdio: "pipe",
    });
    const coluna = (schema: string) => colunas(schema, CONFIG).split("\n").filter((l) => l.startsWith("horario_comercial "));
    expect(coluna(SCHEMA)).toEqual(coluna(PRISMA));
    expect(coluna(SCHEMA)).toHaveLength(1);
    // e é do mesmo tipo dos outros JSON da configuração
    const tipoDe = (c: string) => colunas(PRISMA, CONFIG).split("\n").find((l) => l.startsWith(`${c} `))!.split(" ").slice(1).join(" ");
    expect(tipoDe("horario_comercial")).toBe(tipoDe("qr_config"));
  });

  it("o arquivo só tem o que diz: um ADD COLUMN IF NOT EXISTS — nada de apagar, alterar ou preencher", () => {
    const comandos = readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--") && l.trim()).join("\n");
    expect(comandos).toBe(`ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "horario_comercial" JSONB;`);
  });
});
