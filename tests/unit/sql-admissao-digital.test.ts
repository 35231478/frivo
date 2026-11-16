/**
 * O SQL de produção (prisma/sql/2027-01-05_admissao_digital.sql) rodado de verdade num PostgreSQL
 * descartável, POR CIMA de um banco com colaboradores e cargos já em uso:
 *  - cria TRÊS tabelas (admissões, configuração por empresa e dependentes) e acrescenta colunas
 *    OPCIONAIS em "tecnicos" e "cargos" — e mais nada;
 *  - os colaboradores e cargos que já existem continuam iguais, linha por linha, com as colunas
 *    novas vazias;
 *  - o token é único no banco inteiro: dois convites com o mesmo token são recusados;
 *  - apagar a empresa leva as admissões; apagar o colaborador leva as dele e os dependentes;
 *    apagar o USUÁRIO que gerou o convite NÃO apaga a admissão (SET NULL: o histórico fica);
 *  - é idempotente (roda três vezes, com dados gravados, sem erro e sem mudar nada);
 *  - cria as chaves estrangeiras mesmo com HOMÔNIMOS em outro schema (a guarda olha a tabela, não
 *    só o nome da constraint);
 *  - dá EXATAMENTE o que o Prisma espera (comparado com `prisma db push`).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-admissao-digital
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
vi.setConfig({ testTimeout: 120_000 });
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-05_admissao_digital.sql");
const SCHEMA = `teste_adm_sql_${process.pid}`;
const PRISMA = `teste_adm_prisma_${process.pid}`;
/** Schema ISCA: já tem constraints com os MESMOS nomes. Nome de constraint não é único no banco
 *  (só por tabela), então um script que confere só o nome pularia as chaves estrangeiras aqui. */
const ISCA = `teste_adm_isca_${process.pid}`;
const NOVAS = ["admissoes", "admissao_config", "colaborador_dependentes"];
const A = "admissoes", C = "admissao_config", D = "colaborador_dependentes", T = "tecnicos", G = "cargos";

/** As 19 colunas que esta leva acrescenta no cadastro do colaborador */
const COLUNAS_TECNICO = [
  "pis", "ctps_numero", "ctps_serie", "ctps_uf", "nome_mae", "nome_pai", "estado_civil", "escolaridade",
  "nacionalidade", "naturalidade", "sexo", "titulo_eleitor", "reservista", "banco", "agencia", "conta",
  "conta_tipo", "pix_chave",
];

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string, schema = SCHEMA) => psql(["-c", q], schema);

/** Produção hoje: o que o arquivo referencia, com colaboradores e cargos já em uso */
const BASE = `
  CREATE TYPE "TipoTecnico" AS ENUM ('TECNICO_CAMPO', 'ENGENHEIRO', 'AUXILIAR');
  CREATE TYPE "StatusColaborador" AS ENUM ('ATIVO', 'INATIVO', 'FERIAS', 'AFASTADO');
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL);
  CREATE TABLE "cargos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL, "ativo" BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE "tecnicos" (
    "id" TEXT PRIMARY KEY,
    "empresa_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "tipo" "TipoTecnico" NOT NULL DEFAULT 'TECNICO_CAMPO',
    "cargo_id" TEXT,
    "salario" DECIMAL(12,2),
    "status_colaborador" "StatusColaborador" NOT NULL DEFAULT 'ATIVO',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tecnicos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX "tecnicos_cpf_empresa_id_key" ON "tecnicos" ("cpf", "empresa_id");
  CREATE TABLE "colaborador_documentos" ("id" TEXT PRIMARY KEY, "colaborador_id" TEXT NOT NULL, "tipo" TEXT NOT NULL, "nome" TEXT NOT NULL);
  INSERT INTO "empresas" VALUES ('e1', 'Clima Total'), ('e2', 'Outra');
  INSERT INTO "usuarios" VALUES ('uA', 'e1', 'Ana Souza'), ('uB', 'e2', 'Beto');
  INSERT INTO "cargos" VALUES ('g1', 'e1', 'Técnico de refrigeração', true);
  INSERT INTO "tecnicos" ("id", "empresa_id", "nome", "cpf", "telefone", "cargo_id", "salario", "atualizado_em")
    VALUES ('t1', 'e1', 'Carlos Oliveira', '11144477735', '11999990000', 'g1', 3200.00, now()),
           ('t2', 'e1', 'Marina Alves', '52998224725', '11988887777', NULL, NULL, now());
`;

const colunas = (schema: string, tabela: string) => sql(`SELECT column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-') || ' ' || coalesce(numeric_precision::text, '-') || ',' || coalesce(numeric_scale::text, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tabela}' ORDER BY column_name`).replaceAll(`${schema}.`, "");
const indices = (schema: string, tabela: string) => sql(`SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${tabela}' ORDER BY indexname`);
const chaves = (schema: string, tabela: string) => sql(`SELECT conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid = '${schema}.${tabela}'::regclass ORDER BY conname`);
const tabelas = () => sql(`SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`).split(",");
const linhas = (tabela: string) => sql(`SELECT string_agg(t::text, ';' ORDER BY t::text) FROM "${tabela}" t`);
const retrato = (lista: string[]) => lista.map((t) => `${t}\n${colunas(SCHEMA, t)}\n${indices(SCHEMA, t)}\n${chaves(SCHEMA, t)}\n${linhas(t)}`).join("\n=====\n");

const convite = (id: string, token: string, colaborador = "t1", empresa = "e1", criadoPor: string | null = "uA") =>
  sql(`INSERT INTO "${A}" ("id", "empresa_id", "colaborador_id", "token", "expira_em", "criado_por_id", "atualizado_em")
    VALUES ('${id}', '${empresa}', '${colaborador}', '${token}', now() + interval '7 days', ${criadoPor ? `'${criadoPor}'` : "NULL"}, now())`);

describe.skipIf(!URL)("SQL de produção: admissão digital (PostgreSQL real)", () => {
  let antes = { tabelas: [] as string[], existentes: "", tecnicos: "", cargos: "" };

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE; DROP SCHEMA IF EXISTS ${ISCA} CASCADE; CREATE SCHEMA ${ISCA};`], { stdio: "pipe" });
    // A isca: os mesmos NOMES de constraint, em outro schema. Um script que confere só o nome
    // (sem a tabela) acharia que as chaves já existem e as pularia caladas.
    sql(`CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "admissoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "colaborador_id" TEXT NOT NULL, "criado_por_id" TEXT, "cancelada_por_id" TEXT, "enviado_contador_por_id" TEXT,
        CONSTRAINT "admissoes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id"),
        CONSTRAINT "admissoes_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "tecnicos" ("id"),
        CONSTRAINT "admissoes_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios" ("id"),
        CONSTRAINT "admissoes_cancelada_por_id_fkey" FOREIGN KEY ("cancelada_por_id") REFERENCES "usuarios" ("id"),
        CONSTRAINT "admissoes_enviado_contador_por_id_fkey" FOREIGN KEY ("enviado_contador_por_id") REFERENCES "usuarios" ("id"));
      CREATE TABLE "admissao_config" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL,
        CONSTRAINT "admissao_config_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id"));
      CREATE TABLE "colaborador_dependentes" ("id" TEXT PRIMARY KEY, "colaborador_id" TEXT NOT NULL,
        CONSTRAINT "colaborador_dependentes_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "tecnicos" ("id"));`, ISCA);
    sql(BASE);
    antes = {
      tabelas: tabelas(),
      existentes: retrato(tabelas().filter((t) => t !== T && t !== G)),
      tecnicos: linhas(T), cargos: linhas(G),
    };
    psql(["-f", ARQUIVO]);
  }, 120_000);

  afterAll(() => {
    if (URL) execFileSync("psql", [URL, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${PRISMA} CASCADE; DROP SCHEMA IF EXISTS ${ISCA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria TRÊS tabelas e mais nada; nenhuma outra tabela ganha, perde ou muda coluna, índice, chave ou linha", () => {
    expect(tabelas()).toEqual([...antes.tabelas, ...NOVAS].sort());
    expect(retrato(antes.tabelas.filter((t) => t !== T && t !== G))).toBe(antes.existentes);
    for (const t of NOVAS) expect(sql(`SELECT count(*) FROM "${t}"`), t).toBe("0"); // nascem vazias
  });

  it("os colaboradores e cargos que já existiam continuam EXATAMENTE como estavam (as colunas novas nascem vazias)", () => {
    expect(sql(`SELECT string_agg("id" || '|' || "nome" || '|' || "cpf" || '|' || coalesce("salario"::text, '-') || '|' || "status_colaborador" || '|' || "ativo", ',' ORDER BY "id") FROM "${T}"`))
      .toBe("t1|Carlos Oliveira|11144477735|3200.00|ATIVO|true,t2|Marina Alves|52998224725|-|ATIVO|true");
    const nulas = COLUNAS_TECNICO.map((c) => `"${c}" IS NOT NULL`).join(" OR ");
    expect(sql(`SELECT count(*) FROM "${T}" WHERE ${nulas}`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "${G}" WHERE "cbo" IS NOT NULL`)).toBe("0");
    expect(sql(`SELECT string_agg("id" || '|' || "nome", ',' ORDER BY "id") FROM "${G}"`)).toBe("g1|Técnico de refrigeração");
    // todas as colunas novas são opcionais: um cadastro antigo continua gravável sem nenhuma delas
    for (const c of [...COLUNAS_TECNICO]) {
      expect(colunas(SCHEMA, T).split("\n").find((l) => l.startsWith(`${c} `)), c).toBe(`${c} text text YES - -,-`);
    }
    expect(colunas(SCHEMA, G).split("\n").find((l) => l.startsWith("cbo "))).toBe("cbo text text YES - -,-");
  });

  it("o convite guarda o que precisa, com os padrões certos (situação CONVIDADO, sem envio, sem código)", () => {
    convite("a1", "tok-1");
    expect(sql(`SELECT "situacao" || '|' || "envios" || '|' || "email_codigo_tentativas" || '|' || coalesce("consentimento_em"::text, '-') || '|' || coalesce("rascunho"::text, '-') || '|' || coalesce("assinatura_em"::text, '-') FROM "${A}" WHERE "id" = 'a1'`))
      .toBe("CONVIDADO|0|0|-|-|-");
    // situação é TEXTO (sem enum): o fluxo anda sem migração de tipo
    expect(colunas(SCHEMA, A).split("\n").find((l) => l.startsWith("situacao "))).toBe("situacao text text NO 'CONVIDADO'::text -,-");
    expect(colunas(SCHEMA, A).split("\n").find((l) => l.startsWith("rascunho "))).toBe("rascunho jsonb jsonb YES - -,-");
    // o hash do código, nunca o código
    expect(colunas(SCHEMA, A)).toContain("email_codigo_hash text text YES - -,-");
    expect(colunas(SCHEMA, A)).not.toContain("email_codigo ");
  });

  it("a configuração nasce com validade de 7 dias e experiência 45+45, uma por empresa", () => {
    sql(`INSERT INTO "${C}" ("id", "empresa_id", "atualizado_em") VALUES ('c1', 'e1', now())`);
    expect(sql(`SELECT "validade_dias" || '|' || "experiencia_dias" || '|' || "experiencia_prorrogacao_dias" || '|' || coalesce("contrato_modelo", '-') || '|' || coalesce("documentos"::text, '-') FROM "${C}"`))
      .toBe("7|45|45|-|-");
    expect(() => sql(`INSERT INTO "${C}" ("id", "empresa_id", "atualizado_em") VALUES ('c1b', 'e1', now())`)).toThrow(/admissao_config_empresa_id_key/);
  });

  it("o token é único no banco inteiro: dois convites com o mesmo token são recusados", () => {
    expect(() => convite("a2", "tok-1", "t2")).toThrow(/admissoes_token_key/);
    convite("a2", "tok-2", "t2");
    expect(sql(`SELECT count(*) FROM "${A}"`)).toBe("2");
  });

  it("o dependente é do colaborador, com os marcadores de IRRF e salário-família", () => {
    sql(`INSERT INTO "${D}" ("id", "colaborador_id", "nome", "parentesco", "irrf") VALUES ('d1', 't1', 'Lucas Oliveira', 'FILHO', true)`);
    expect(sql(`SELECT "parentesco" || '|' || "irrf" || '|' || "salario_familia" || '|' || coalesce("cpf", '-') FROM "${D}" WHERE "id" = 'd1'`)).toBe("FILHO|true|false|-");
  });

  it("as chaves estrangeiras existem e apontam para onde devem — mesmo com HOMÔNIMOS em outro schema", () => {
    // a isca (mesmos nomes, outro schema) continua lá: é ela que prova que a guarda olha a tabela
    expect(chaves(ISCA, A)).toContain("admissoes_empresa_id_fkey");
    const fks = chaves(SCHEMA, A);
    expect(fks).toContain("admissoes_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(fks).toContain("admissoes_colaborador_id_fkey FOREIGN KEY (colaborador_id) REFERENCES tecnicos(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(fks).toContain("admissoes_criado_por_id_fkey FOREIGN KEY (criado_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");
    expect(fks).toContain("admissoes_cancelada_por_id_fkey FOREIGN KEY (cancelada_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");
    expect(fks).toContain("admissoes_enviado_contador_por_id_fkey FOREIGN KEY (enviado_contador_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL");
    expect(chaves(SCHEMA, C)).toContain("admissao_config_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(chaves(SCHEMA, D)).toContain("colaborador_dependentes_colaborador_id_fkey FOREIGN KEY (colaborador_id) REFERENCES tecnicos(id) ON UPDATE CASCADE ON DELETE CASCADE");
  });

  it("apagar o USUÁRIO que gerou o convite não apaga a admissão (o histórico fica, sem o autor)", () => {
    sql(`INSERT INTO "usuarios" VALUES ('uTemp', 'e1', 'Quem sai da empresa')`);
    convite("a3", "tok-3", "t2", "e1", "uTemp");
    sql(`DELETE FROM "usuarios" WHERE "id" = 'uTemp'`);
    expect(sql(`SELECT "criado_por_id" IS NULL || '|' || "situacao" FROM "${A}" WHERE "id" = 'a3'`)).toBe("true|CONVIDADO");
  });

  it("apagar o colaborador leva as admissões e os dependentes dele; apagar a empresa leva tudo dela", () => {
    sql(`DELETE FROM "${A}" WHERE "id" = 'a3'`);
    sql(`DELETE FROM "tecnicos" WHERE "id" = 't2'`);
    expect(sql(`SELECT count(*) FROM "${A}" WHERE "colaborador_id" = 't2'`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "${A}"`)).toBe("1"); // a1, de t1
    sql(`INSERT INTO "tecnicos" ("id", "empresa_id", "nome", "cpf", "telefone", "atualizado_em") VALUES ('tE2', 'e2', 'Da outra', '1', '1', now())`);
    convite("aE2", "tok-e2", "tE2", "e2", "uB");
    sql(`INSERT INTO "${D}" ("id", "colaborador_id", "nome") VALUES ('dE2', 'tE2', 'Filho')`);
    sql(`DELETE FROM "empresas" WHERE "id" = 'e2'`);
    expect(sql(`SELECT count(*) FROM "${A}" WHERE "empresa_id" = 'e2'`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "${D}" WHERE "id" = 'dE2'`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "${D}" WHERE "id" = 'd1'`)).toBe("1"); // o de t1 segue
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
    // as três tabelas nascem inteiras neste SQL: têm de bater coluna por coluna
    for (const t of NOVAS) expect(colunas(SCHEMA, t), t).toBe(colunas(PRISMA, t).replaceAll(`${PRISMA}.`, ""));

    // "tecnicos" e "cargos" aqui são a versão reduzida que o teste monta (produção tem mais
    // colunas): comparo só as colunas que ESTA leva acrescenta
    const DESTA_LEVA = new RegExp(`^(${COLUNAS_TECNICO.join("|")}) `);
    const minhas = colunas(SCHEMA, T).split("\n").filter((l) => DESTA_LEVA.test(l));
    expect(minhas, "as colunas novas do colaborador").toEqual(colunas(PRISMA, T).split("\n").filter((l) => DESTA_LEVA.test(l)));
    expect(minhas).toHaveLength(COLUNAS_TECNICO.length);
    expect(colunas(SCHEMA, G).split("\n").filter((l) => l.startsWith("cbo "))).toEqual(colunas(PRISMA, G).split("\n").filter((l) => l.startsWith("cbo ")));

    // e os índices das tabelas novas
    for (const t of NOVAS) {
      const meus = indices(SCHEMA, t).replaceAll(`${SCHEMA}.`, "").split("\n").sort();
      const dele = indices(PRISMA, t).replaceAll(`${PRISMA}.`, "").split("\n").sort();
      expect(meus, t).toEqual(dele);
    }
  });
});
