/**
 * O SQL de produção (prisma/sql/2027-01-09_prazos_execucao_atendimento.sql) rodado de verdade num
 * PostgreSQL descartável, POR CIMA de um banco com OS, tipos de OS e contratos já em uso:
 *  - cria UMA tabela (o prazo de atendimento do contrato) e acrescenta colunas OPCIONAIS em
 *    "ordens_servico" (9) e "tipos_os" (1) — e mais nada;
 *  - as OS que já existem continuam iguais, linha por linha: a data prevista não é tocada e o prazo
 *    de execução nasce VAZIO (não há preenchimento retroativo — a regra "sem prazo próprio, vale o dia
 *    previsto" fica no sistema, então nenhuma OS muda de "no prazo" para "atrasada" nem o contrário);
 *  - o prazo de execução é um DIA (sem hora);
 *  - uma linha por contrato e prioridade; a prioridade é o enum que a OS já usa;
 *  - apagar o contrato leva os prazos dele; apagar o usuário NÃO apaga a OS nem a justificativa;
 *  - é idempotente (roda três vezes, com dados gravados, sem erro e sem mudar nada);
 *  - cria as chaves estrangeiras mesmo com um HOMÔNIMO em outro schema;
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-prazos-execucao-atendimento
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 120_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-09_prazos_execucao_atendimento.sql");
const SCHEMA = `teste_prazos_sql_${process.pid}`;
const PRISMA = `teste_prazos_prisma_${process.pid}`;
/** Schema ISCA: já tem constraints com os MESMOS nomes (nome de constraint só é único por tabela) */
const ISCA = `teste_prazos_isca_${process.pid}`;
const OS = "ordens_servico", TIPO = "tipos_os", PRAZO = "contrato_prazos_atendimento";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção hoje: o que o arquivo referencia, com OS já em uso (a data prevista fazendo o papel de prazo) */
const BASE = `
  CREATE TYPE "Prioridade" AS ENUM ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE', 'CRITICO');
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "contratos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "numero" TEXT NOT NULL);
  CREATE TABLE "tipos_os" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL, "exige_equipamento" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "ordens_servico" (
    "id" TEXT PRIMARY KEY,
    "empresa_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "contrato_id" TEXT,
    "prioridade" "Prioridade" NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "descricao" TEXT NOT NULL,
    "previsao_conclusao" TIMESTAMP(3),
    "data_conclusao" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL
  );
  CREATE INDEX "ordens_servico_empresa_id_previsao_conclusao_idx" ON "ordens_servico" ("empresa_id", "previsao_conclusao");
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total');
  INSERT INTO "usuarios" VALUES ('u1', 'e1', 'Ana'), ('u2', 'e1', 'Zeca');
  INSERT INTO "contratos" VALUES ('ct1', 'e1', 'CT-1'), ('ct2', 'e1', 'CT-2');
  INSERT INTO "tipos_os" ("id", "empresa_id", "nome") VALUES ('tp1', 'e1', 'Preventiva'), ('tp2', 'e1', 'Corretiva');
  INSERT INTO "ordens_servico" ("id", "empresa_id", "numero", "contrato_id", "status", "descricao", "previsao_conclusao", "atualizado_em") VALUES
    ('os1', 'e1', 'OS-1', NULL, 'ABERTA', 'Manual com "prazo para finalizar" (só o dia)', '2026-11-10 00:00:00', '2026-11-01 12:00:00'),
    ('os2', 'e1', 'OS-2', 'ct1', 'AGENDADA', 'Recorrente (data agendada)', '2026-11-20 15:00:00', '2026-11-01 12:00:00'),
    ('os3', 'e1', 'OS-3', NULL, 'ABERTA', 'Sem data nenhuma', NULL, '2026-11-01 12:00:00');
`;

const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`).split(",");
const linhas = (tabela: string) => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM "${tabela}" t`);
const retrato = (lista: string[]) => lista.map((t) => `${t}\n${colunas(SCHEMA, t)}\n${indices(SCHEMA, t)}\n${chaves(SCHEMA, t)}\n${linhas(t)}`).join("\n=====\n");

const NOVAS_DA_OS = [
  "atendimento_comparecer_ate", "atendimento_comparecido_em", "atendimento_resolver_ate", "atraso_justificado_em",
  "atraso_justificado_motivo", "atraso_justificado_obs", "atraso_justificado_por_id", "chamado_aberto_em", "prazo_execucao",
];
const prazo = (id: string, contrato: string, prioridade: string, extra = "") =>
  sql(`INSERT INTO "${PRAZO}" ("id", "empresa_id", "contrato_id", "prioridade", "comparecer_horas", "resolver_horas", "atualizado_em"${extra ? ', "so_horario_comercial"' : ""})
    VALUES ('${id}', 'e1', '${contrato}', '${prioridade}', 4, 24, now()${extra ? `, ${extra}` : ""})`);

describe.skipIf(!URL)("SQL de produção: prazo de execução e prazo de atendimento (PostgreSQL real)", () => {
  let antes = { tabelas: [] as string[], intocadas: "", os: "", tipos: "" };
  const INTOCADAS = ["empresas", "usuarios", "contratos"];
  const ANTIGAS_DA_OS = `"id", "empresa_id", "numero", "contrato_id", "prioridade", "status", "descricao", "previsao_conclusao", "data_conclusao", "atualizado_em"`;
  const osAntigas = () => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM (SELECT ${ANTIGAS_DA_OS} FROM "${OS}") t`);

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE; DROP SCHEMA IF EXISTS ${ISCA} CASCADE; CREATE SCHEMA ${ISCA};`], { stdio: "pipe" });
    // A isca: os mesmos NOMES de constraint, em outro schema
    sql(`CREATE TABLE "contratos" ("id" TEXT PRIMARY KEY); CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contrato_prazos_atendimento" ("id" TEXT PRIMARY KEY, "contrato_id" TEXT,
        CONSTRAINT "contrato_prazos_atendimento_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos" ("id"));
      CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY, "atraso_justificado_por_id" TEXT,
        CONSTRAINT "ordens_servico_atraso_justificado_por_id_fkey" FOREIGN KEY ("atraso_justificado_por_id") REFERENCES "usuarios" ("id"));`, ISCA);
    sql(BASE);
    antes = { tabelas: tabelas(), intocadas: retrato(INTOCADAS), os: osAntigas(), tipos: sql(`SELECT string_agg("id" || '|' || "nome" || '|' || "exige_equipamento", ',' ORDER BY "id") FROM "${TIPO}"`) };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE; DROP SCHEMA IF EXISTS ${ISCA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria UMA tabela e mais nada; as tabelas que o arquivo não cita ficam idênticas", () => {
    expect(tabelas()).toEqual([...antes.tabelas, PRAZO].sort());
    expect(retrato(INTOCADAS)).toBe(antes.intocadas);
    expect(sql(`SELECT count(*) FROM "${PRAZO}"`)).toBe("0"); // nasce vazia
  });

  it("as OS que já existiam continuam EXATAMENTE como estavam: a data prevista não é tocada e NADA é preenchido por palpite", () => {
    expect(osAntigas()).toBe(antes.os);
    // as nove colunas novas: todas opcionais e vazias em todas as OS antigas — inclusive o prazo de execução
    const cols = colunas(SCHEMA, OS).split("\n");
    for (const c of NOVAS_DA_OS) expect(cols.find((l) => l.startsWith(`${c} `)), c).toMatch(/ YES -$/);
    expect(sql(`SELECT count(*) FROM "${OS}" WHERE ${NOVAS_DA_OS.map((c) => `"${c}" IS NOT NULL`).join(" OR ")}`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "${OS}"`)).toBe("3");
    // e as colunas que a OS tinha continuam todas lá (nada foi removido nem renomeado)
    expect(cols.filter((l) => !NOVAS_DA_OS.some((c) => l.startsWith(`${c} `))).map((l) => l.split(" ")[0]))
      .toEqual(["atualizado_em", "contrato_id", "criado_em", "data_conclusao", "descricao", "empresa_id", "id", "numero", "previsao_conclusao", "prioridade", "status"]);
  });

  it("o prazo de execução é um DIA (sem hora); os limites do atendimento são instantes", () => {
    const cols = colunas(SCHEMA, OS).split("\n");
    expect(cols.find((l) => l.startsWith("prazo_execucao "))).toBe("prazo_execucao date date YES -");
    for (const c of ["chamado_aberto_em", "atendimento_comparecer_ate", "atendimento_resolver_ate", "atendimento_comparecido_em", "atraso_justificado_em"])
      expect(cols.find((l) => l.startsWith(`${c} `)), c).toBe(`${c} timestamp without time zone timestamp YES -`);
    sql(`UPDATE "${OS}" SET "prazo_execucao" = '2026-11-25 18:30:00' WHERE "id" = 'os3'`);
    expect(sql(`SELECT "prazo_execucao"::text FROM "${OS}" WHERE "id" = 'os3'`)).toBe("2026-11-25"); // a hora não é guardada
    sql(`UPDATE "${OS}" SET "prazo_execucao" = NULL WHERE "id" = 'os3'`);
  });

  it("o tipo de OS ganha o prazo padrão em dias, vazio em todos os tipos que já existiam", () => {
    expect(colunas(SCHEMA, TIPO).split("\n").find((l) => l.startsWith("prazo_execucao_dias "))).toBe("prazo_execucao_dias integer int4 YES -");
    expect(sql(`SELECT count(*) FROM "${TIPO}" WHERE "prazo_execucao_dias" IS NOT NULL`)).toBe("0");
    expect(sql(`SELECT string_agg("id" || '|' || "nome" || '|' || "exige_equipamento", ',' ORDER BY "id") FROM "${TIPO}"`)).toBe(antes.tipos);
  });

  it("o prazo de atendimento: uma linha por contrato e prioridade, com os padrões certos e a prioridade da OS", () => {
    prazo("p1", "ct1", "URGENTE");
    expect(sql(`SELECT "prioridade" || '|' || "comparecer_horas" || '|' || "resolver_horas" || '|' || "so_horario_comercial" FROM "${PRAZO}" WHERE "id" = 'p1'`)).toBe("URGENTE|4|24|false");
    expect(() => prazo("p1dup", "ct1", "URGENTE")).toThrow(/contrato_prazos_atendimento_contrato_id_prioridade_key/);
    prazo("p2", "ct1", "NORMAL", "true"); // outra prioridade no mesmo contrato
    prazo("p3", "ct2", "URGENTE"); // a mesma prioridade em OUTRO contrato
    expect(() => prazo("p4", "ct2", "EMERGENCIAL")).toThrow(/invalid input value for enum "Prioridade"/); // não é um segundo conjunto de prioridades
    // dá para prometer só o comparecimento
    sql(`INSERT INTO "${PRAZO}" ("id", "empresa_id", "contrato_id", "prioridade", "comparecer_horas", "atualizado_em") VALUES ('p5', 'e1', 'ct2', 'ALTA', 8, now())`);
    expect(sql(`SELECT coalesce("resolver_horas"::text, '-') FROM "${PRAZO}" WHERE "id" = 'p5'`)).toBe("-");
  });

  it("as chaves estrangeiras existem e apontam para onde devem — mesmo com HOMÔNIMO em outro schema", () => {
    expect(chaves(ISCA, PRAZO)).toContain("contrato_prazos_atendimento_contrato_id_fkey");
    expect(chaves(SCHEMA, PRAZO)).toContain("contrato_prazos_atendimento_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(chaves(SCHEMA, OS)).toContain("ordens_servico_atraso_justificado_por_id_fkey FOREIGN KEY (atraso_justificado_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");
  });

  it("apagar o contrato leva os prazos dele; apagar o usuário NÃO apaga a OS nem a justificativa", () => {
    sql(`DELETE FROM "contratos" WHERE "id" = 'ct2'`);
    expect(sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "${PRAZO}"`)).toBe("p1,p2");
    sql(`UPDATE "${OS}" SET "atraso_justificado_motivo" = 'CLIENTE_AUSENTE', "atraso_justificado_obs" = 'Portaria não liberou', "atraso_justificado_por_id" = 'u2', "atraso_justificado_em" = '2026-11-12 14:00:00' WHERE "id" = 'os1'`);
    sql(`DELETE FROM "usuarios" WHERE "id" = 'u2'`);
    expect(sql(`SELECT "atraso_justificado_motivo" || '|' || "atraso_justificado_obs" || '|' || coalesce("atraso_justificado_por_id", '-') || '|' || "atraso_justificado_em" FROM "${OS}" WHERE "id" = 'os1'`))
      .toBe("CLIENTE_AUSENTE|Portaria não liberou|-|2026-11-12 14:00:00");
    expect(() => sql(`UPDATE "${OS}" SET "atraso_justificado_por_id" = 'nao-existe' WHERE "id" = 'os1'`)).toThrow(/ordens_servico_atraso_justificado_por_id_fkey/);
  });

  it("é idempotente: roda de novo, com dados gravados, sem erro e sem mudar nada", () => {
    const antesDeRodar = retrato(tabelas());
    psql(["-f", ARQUIVO]);
    psql(["-f", ARQUIVO]);
    expect(retrato(tabelas())).toBe(antesDeRodar);
  });

  it("dá exatamente o que o Prisma espera (comparado com `prisma db push`)", () => {
    execFileSync("psql", [URL!, "-q", "-c", `CREATE SCHEMA ${PRISMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}` }, stdio: "pipe",
    });
    const semSchema = (t: string) => t.replaceAll(`${PRISMA}.`, "").replaceAll(`${SCHEMA}.`, "");
    // a tabela nova nasce inteira neste SQL: bate coluna por coluna, índice por índice, chave por chave
    expect(colunas(SCHEMA, PRAZO), "colunas do prazo").toBe(semSchema(colunas(PRISMA, PRAZO)));
    expect(semSchema(indices(SCHEMA, PRAZO)), "índices do prazo").toBe(semSchema(indices(PRISMA, PRAZO)));
    expect(chaves(SCHEMA, PRAZO), "chaves do prazo").toBe(semSchema(chaves(PRISMA, PRAZO)));

    // "ordens_servico" e "tipos_os" aqui são versões reduzidas: comparo as colunas que ESTA leva acrescenta
    const desta = (schema: string, tabela: string, nomes: string[]) => colunas(schema, tabela).split("\n").filter((l) => nomes.some((c) => l.startsWith(`${c} `))).map(semSchema);
    expect(desta(SCHEMA, OS, NOVAS_DA_OS)).toEqual(desta(PRISMA, OS, NOVAS_DA_OS));
    expect(desta(SCHEMA, OS, NOVAS_DA_OS)).toHaveLength(9);
    expect(desta(SCHEMA, TIPO, ["prazo_execucao_dias"])).toEqual(desta(PRISMA, TIPO, ["prazo_execucao_dias"]));
    // o índice e a chave novos da OS
    const indiceNovo = (schema: string) => semSchema(indices(schema, OS)).split("\n").filter((i) => /prazo_execucao/.test(i));
    expect(indiceNovo(SCHEMA)).toEqual(indiceNovo(PRISMA));
    expect(indiceNovo(SCHEMA)).toHaveLength(1);
    const chaveNova = (schema: string) => semSchema(chaves(schema, OS)).split("\n").filter((c) => /atraso_justificado/.test(c));
    expect(chaveNova(SCHEMA)).toEqual(chaveNova(PRISMA));
  });
});
