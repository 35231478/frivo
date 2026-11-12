/**
 * PMOC — OCORRÊNCIAS: o SQL de produção (prisma/sql/2026-12-22_pmoc_ocorrencias.sql) rodado de verdade
 * num PostgreSQL descartável, POR CIMA de um banco que já tem planos, equipamentos, OS e orçamentos:
 *  - cria UMA tabela ("pmoc_ocorrencias") e mais nada — nenhuma tabela que já existe ganha coluna;
 *  - é idempotente (roda três vezes), inclusive com ocorrências já gravadas;
 *  - não cria nem altera enum: gravidade, situação e origem são TEXTO, com os padrões 'ABERTA' e 'MANUAL';
 *  - as ligações: apagar o plano apaga as ocorrências dele; apagar equipamento, OS, atividade, resposta
 *    do checklist ou orçamento só SOLTA a ocorrência; uma resposta do checklist gera no máximo uma;
 *  - o resultado é EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-pmoc-ocorrencias
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2026-12-22_pmoc_ocorrencias.sql");
const SCHEMA = `teste_ocorrencias_sql_${process.pid}`;
const PRISMA = `teste_ocorrencias_sql_prisma_${process.pid}`;
const T = "pmoc_ocorrencias";

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** As tabelas a que a ocorrência se liga, como já existem em produção (só o necessário), com dados gravados */
const ANTIGAS = ["pmocs", "equipamentos", "ordens_servico", "atividades_os", "checklist_respostas", "orcamentos"];
const BASE = `
  ${ANTIGAS.map((t) => `CREATE TABLE "${t}" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);`).join("\n  ")}
  INSERT INTO "pmocs" VALUES ('p1', 'PMOC 2027'), ('p2', 'PMOC da filial');
  INSERT INTO "equipamentos" VALUES ('q1', 'Split da recepção');
  INSERT INTO "ordens_servico" VALUES ('os1', 'OS-1'), ('os2', 'OS-2 corretiva');
  INSERT INTO "atividades_os" VALUES ('a1', 'Visita 1');
  INSERT INTO "checklist_respostas" VALUES ('r1', 'Atenção: dreno entupido');
  INSERT INTO "orcamentos" VALUES ('o1', 'Orçamento do dreno');
`;
const colunas = (schema: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(datetime_precision::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${T}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${T}' ORDER BY indexname`);
const chaves = (schema: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${T}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`);
const estrutura = (tabela: string) => sql(`SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}'`);
const conteudo = (tabela: string) => sql(`SELECT string_agg("id" || '|' || "nome", ';' ORDER BY "id") FROM "${tabela}"`);
/** Grava uma ocorrência só com o obrigatório (mais o que o teste pedir) e devolve os padrões que o banco pôs */
const ocorrencia = (id: string, extra: Record<string, string> = {}) => {
  const campos = { id, empresa_id: "e1", pmoc_id: "p1", data: "2026-11-12", descricao: "Vazamento na bandeja", gravidade: "ALTA", atualizado_em: "2026-11-12 15:00", ...extra };
  return sql(`INSERT INTO "${T}" (${Object.keys(campos).map((c) => `"${c}"`).join(", ")}) VALUES (${Object.values(campos).map((v) => `'${v}'`).join(", ")})
    RETURNING "situacao" || '|' || "origem" || '|' || "ativo" || '|' || ("criado_em" IS NOT NULL)`);
};
const ligacoes = (id: string) => sql(`SELECT concat_ws('|', coalesce("equipamento_id", '-'), coalesce("ordem_servico_id", '-'), coalesce("atividade_id", '-'), coalesce("checklist_resposta_id", '-'), coalesce("orcamento_id", '-'), coalesce("os_corretiva_id", '-'))
  FROM "${T}" WHERE "id" = '${id}'`);

describe.skipIf(!URL)("SQL de produção: PMOC — ocorrências (PostgreSQL real)", () => {
  const antes: Record<string, string> = {};

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
    sql(BASE);
    for (const t of ANTIGAS) antes[t] = `${estrutura(t)} / ${conteudo(t)}`;
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria UMA tabela e mais nada: o que já existia fica como estava, na estrutura e nos dados", () => {
    expect(tabelas()).toBe([...ANTIGAS, T].sort().join(","));
    for (const t of ANTIGAS) expect(`${estrutura(t)} / ${conteudo(t)}`, t).toBe(antes[t]);
    expect(sql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${T}'`)).toBe([
      "id", "empresa_id", "pmoc_id", "equipamento_id", "data", "descricao", "gravidade", "situacao", "resolvida_em", "resolucao", "resolvida_por_id",
      "anexo", "anexo_nome", "anexo_tipo", "anexo_tamanho", "origem", "ordem_servico_id", "atividade_id", "checklist_resposta_id", "orcamento_id", "os_corretiva_id",
      "ativo", "criado_por_id", "criado_em", "atualizado_em",
    ].join(","));
    expect(sql(`SELECT count(*) FROM "${T}"`)).toBe("0");
  });

  it("gravidade, situação e origem são TEXTO (nenhum enum); a ocorrência nasce Aberta, manual e valendo", () => {
    expect(ocorrencia("oc1")).toBe("ABERTA|MANUAL|true|true");
    expect(sql(`SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${T}' AND column_name IN ('gravidade', 'situacao', 'origem', 'data', 'resolvida_em')`))
      .toBe("data:date,gravidade:text,origem:text,resolvida_em:date,situacao:text");
    expect(sql(`SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typtype = 'e'`)).toBe("0");
    // O obrigatório é obrigatório: sem descrição, gravidade ou data não grava
    for (const campo of ["descricao", "gravidade", "data", "pmoc_id", "empresa_id"])
      expect(() => sql(`INSERT INTO "${T}" ("id", "empresa_id", "pmoc_id", "data", "descricao", "gravidade", "atualizado_em") VALUES ('x', 'e1', 'p1', '2026-11-12', 'd', 'ALTA', now()); UPDATE "${T}" SET "${campo}" = NULL WHERE "id" = 'x'`), campo).toThrow(/null value in column/);
    expect(sql(`SELECT count(*) FROM "${T}" WHERE "id" = 'x'`)).toBe("0"); // a tentativa inteira foi desfeita
  });

  it("é IDEMPOTENTE: rodar de novo (três vezes) não dá erro e não muda nada — nem com ocorrências já gravadas", () => {
    ocorrencia("oc2", { equipamento_id: "q1", ordem_servico_id: "os1", situacao: "RESOLVIDA", resolvida_em: "2026-11-13", resolucao: "Dreno desobstruído" });
    const retrato = () => [tabelas(), colunas(SCHEMA), indices(SCHEMA), chaves(SCHEMA),
      sql(`SELECT string_agg(concat_ws('|', "id", "situacao", "gravidade", "data", coalesce("resolvida_em"::text, '-'), coalesce("resolucao", '-'), coalesce("equipamento_id", '-'), coalesce("ordem_servico_id", '-')), ';' ORDER BY "id") FROM "${T}"`)].join("\n---\n");
    const antesDeRepetir = retrato();
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO]);
    expect(retrato()).toBe(antesDeRepetir);
    expect(retrato()).toContain("oc2|RESOLVIDA|ALTA|2026-11-12|2026-11-13|Dreno desobstruído|q1|os1");
  });

  it("as ligações só aceitam o que existe; uma resposta do checklist vira no máximo UMA ocorrência", () => {
    for (const [coluna, chave] of [["pmoc_id", "pmoc_id"], ["equipamento_id", "equipamento_id"], ["ordem_servico_id", "ordem_servico_id"], ["atividade_id", "atividade_id"],
      ["checklist_resposta_id", "checklist_resposta_id"], ["orcamento_id", "orcamento_id"], ["os_corretiva_id", "os_corretiva_id"]])
      expect(() => ocorrencia(`ruim-${coluna}`, { [coluna]: "nao-existe" }), coluna).toThrow(new RegExp(`pmoc_ocorrencias_${chave}_fkey`));
    // O modelo já aceita as ligações das próximas etapas: a "Atenção" do técnico, o orçamento e a OS corretiva
    ocorrencia("oc3", { equipamento_id: "q1", ordem_servico_id: "os1", atividade_id: "a1", checklist_resposta_id: "r1", orcamento_id: "o1", os_corretiva_id: "os2", origem: "APP" });
    expect(ligacoes("oc3")).toBe("q1|os1|a1|r1|o1|os2");
    expect(() => ocorrencia("oc3-repetida", { checklist_resposta_id: "r1" })).toThrow(/pmoc_ocorrencias_checklist_resposta_id_key/);
    ocorrencia("oc4"); ocorrencia("oc5"); // sem resposta do checklist, quantas forem
  });

  it("apagar equipamento, OS, atividade, resposta ou orçamento só SOLTA a ocorrência; apagar o PLANO apaga as dele", () => {
    sql(`DELETE FROM "equipamentos" WHERE "id" = 'q1'; DELETE FROM "atividades_os" WHERE "id" = 'a1'; DELETE FROM "checklist_respostas" WHERE "id" = 'r1'; DELETE FROM "orcamentos" WHERE "id" = 'o1'; DELETE FROM "ordens_servico" WHERE "id" = 'os2'`);
    expect(ligacoes("oc3")).toBe("-|os1|-|-|-|-");
    sql(`DELETE FROM "ordens_servico" WHERE "id" = 'os1'`);
    expect(ligacoes("oc3")).toBe("-|-|-|-|-|-");
    expect(sql(`SELECT count(*) FROM "${T}" WHERE "pmoc_id" = 'p1'`)).toBe("5");
    ocorrencia("oc-filial", { pmoc_id: "p2" });
    sql(`DELETE FROM "pmocs" WHERE "id" = 'p1'`);
    expect(sql(`SELECT string_agg("id", ',') FROM "${T}"`)).toBe("oc-filial");
  });

  it("não cria enum, não apaga nem altera nada, e cada criação tem a sua guarda de idempotência", () => {
    const fonte = fs.readFileSync(ARQUIVO, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    // "ON DELETE …" e "ON UPDATE …" são regras das chaves estrangeiras, não comandos
    expect(fonte).not.toMatch(/CREATE TYPE|ALTER TYPE|DROP |TRUNCATE|(?<!ON )DELETE |(?<!ON )UPDATE |ALTER COLUMN|ADD COLUMN|RENAME|INSERT /);
    expect(fonte.match(/^\s*CREATE (UNIQUE )?(TABLE|INDEX)/gm)).toHaveLength(6);            // a tabela e 5 índices
    expect(fonte.match(/ADD CONSTRAINT/g)).toHaveLength(7);                                  // as 7 chaves estrangeiras
    expect(fonte.match(/IF NOT EXISTS/g)).toHaveLength(6 + 7);                               // cada criação com a sua guarda
    // Só a tabela nova é alterada (para ganhar as chaves): nenhuma tabela que já existe é tocada
    expect([...new Set([...fonte.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]))]).toEqual([T]);
    expect(fonte).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/m);
  });

  it("o resultado é EXATAMENTE o que o Prisma espera: colunas, índices e chaves da tabela nova", () => {
    const url = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${PRISMA}`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    for (const f of [colunas, indices, chaves]) expect(f(SCHEMA)).toBe(f(PRISMA));
    expect(indices(SCHEMA).split("\n")).toHaveLength(6); // a chave primária e os 5 do arquivo
    expect(chaves(SCHEMA)).toContain("pmoc_ocorrencias_pmoc_id_fkey FOREIGN KEY (pmoc_id) REFERENCES pmocs(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(chaves(SCHEMA)).toContain("pmoc_ocorrencias_ordem_servico_id_fkey FOREIGN KEY (ordem_servico_id) REFERENCES ordens_servico(id) ON UPDATE CASCADE ON DELETE SET NULL");
  }, 180_000);
});
