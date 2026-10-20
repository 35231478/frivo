/**
 * Execução da OS — etapa 2 (app do técnico): o SQL de produção (prisma/sql/2026-10-21_app_tecnico.sql)
 * rodado de verdade num PostgreSQL, num schema descartável que já passou pelo SQL da etapa 1, com
 * checklists de fábrica intactos, um editado pela empresa e um personalizado que usou a sugestão.
 * Roda o arquivo DUAS vezes e confere; e confere que, sem a etapa 1, ele para sem mexer em nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-app-tecnico
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ITENS_BASE, TIPOS_PADRAO } from "@/lib/checklist/padrao";

const URL = process.env.PG_TESTE_URL;
const ETAPA1 = path.resolve(__dirname, "../../prisma/sql/2026-10-20_execucao_os_checklist.sql");
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-21_app_tecnico.sql");
const SCHEMA = `teste_app_tec_${process.pid}`;
const VAZIO = `teste_app_tec_vazio_${process.pid}`;

function psql(args: string[], schema = SCHEMA) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const linhas = (q: string) => sql(q).split("\n").filter(Boolean);
/** Em ordem de bytes, igual em qualquer collation */
const ordenadas = (q: string) => linhas(q).sort();

const ENUM_HOJE = ["AR_CONDICIONADO_SPLIT", "AR_CONDICIONADO_JANELA", "AR_CONDICIONADO_CENTRAL", "AR_CONDICIONADO_PORTATIL", "CHILLER", "TORRE_RESFRIAMENTO",
  "CAMARA_FRIA", "CAMARA_CLIMATIZADA", "REFRIGERADOR_COMERCIAL", "CONGELADOR_COMERCIAL", "VRF", "FANCOIL", "CONDENSADORA", "EVAPORADORA", "OUTRO"];
const BASE = `
  CREATE TYPE "TipoEquipamento" AS ENUM (${ENUM_HOJE.map((v) => `'${v}'`).join(", ")});
  CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "tipos_equipamento_custom" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"), "nome" TEXT NOT NULL,
    "descricao" TEXT, "chave_enum" TEXT, "ativo" BOOLEAN NOT NULL DEFAULT true, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT now());
  CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "tipo" "TipoEquipamento" NOT NULL, "tipo_equipamento_id" TEXT);
  CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY);
  CREATE TABLE "atividade_equipamentos" ("id" TEXT PRIMARY KEY, "atividade_id" TEXT NOT NULL, "equipamento_id" TEXT NOT NULL,
    "feito" BOOLEAN NOT NULL DEFAULT false, "feito_em" TIMESTAMP(3), "criado_em" TIMESTAMP(3) NOT NULL DEFAULT now());`;

describe.skipIf(!URL)("SQL de produção: app do técnico — medição, áudio, antes/depois, serviço adicional, sync (PostgreSQL real)", () => {
  let contagemPrimeira = "";

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; DROP SCHEMA IF EXISTS ${VAZIO} CASCADE; CREATE SCHEMA ${VAZIO};`]);
    sql(BASE + `
      INSERT INTO "empresas" VALUES ('e1'), ('e2');
      -- e2: um tipo personalizado que usou "Usar checklist sugerido" (itens-base) e outro sem checklist
      INSERT INTO "tipos_equipamento_custom" ("id", "empresa_id", "nome", "chave_enum") VALUES ('e2-split', 'e2', 'Split', NULL), ('e2-vazio', 'e2', 'Bebedouro', NULL);
      INSERT INTO "equipamentos" VALUES ('eq1', 'e1', 'AR_CONDICIONADO_SPLIT', NULL);
    `);
    psql(["-f", ETAPA1]);
    // e2-split recebe a sugestão da etapa 1 (itens-base) como a tela fazia
    sql(`INSERT INTO "checklist_tipo_itens" ("id", "empresa_id", "tipo_equipamento_id", "texto", "pedir_foto", "pedir_observacao", "ordem", "atualizado_em")
         SELECT 'b' || i."ordem", 'e2', 'e2-split', i."texto", i."pedir_foto", i."pedir_observacao", i."ordem", now()
         FROM "checklist_tipo_itens" i JOIN "tipos_equipamento_custom" t ON t."id" = i."tipo_equipamento_id"
         WHERE t."empresa_id" = 'e1' AND t."chave_enum" = 'AR_CONDICIONADO_SPLIT'`);
    // e1 já respondeu a medição antiga do Split numa atividade (a resposta tem de sobreviver)
    sql(`INSERT INTO "atividades_os" VALUES ('a1'); INSERT INTO "usuarios" VALUES ('u1');
         INSERT INTO "checklist_respostas" ("id", "empresa_id", "atividade_id", "equipamento_id", "item_id", "status", "observacao", "texto_item", "atualizado_em")
         SELECT 'r-velha', 'e1', 'a1', 'eq1', i."id", 'OK', '118/340 psi', i."texto", now()
         FROM "checklist_tipo_itens" i JOIN "tipos_equipamento_custom" t ON t."id" = i."tipo_equipamento_id"
         WHERE t."empresa_id" = 'e1' AND t."chave_enum" = 'AR_CONDICIONADO_SPLIT' AND i."texto" = 'Medição de pressão de sucção e de descarga'`);
    // e2 EDITOU o checklist do Chiller (trocou o texto de um item): não pode ser tocado
    sql(`UPDATE "checklist_tipo_itens" SET "texto" = 'Pressostatos (alta, baixa e óleo)' WHERE "texto" = 'Pressostatos de alta e de baixa'
         AND "tipo_equipamento_id" IN (SELECT "id" FROM "tipos_equipamento_custom" WHERE "empresa_id" = 'e2' AND "chave_enum" = 'CHILLER')`);
    psql(["-f", ARQUIVO]);
    contagemPrimeira = sql(`SELECT (SELECT count(*) FROM "checklist_tipo_itens") || '|' || (SELECT count(*) FROM "checklist_tipo_itens" WHERE "ativo")`);
    psql(["-f", ARQUIVO]); // 2ª vez: não pode falhar nem repetir nada
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${VAZIO} CASCADE;`]); });

  it("sem o SQL da etapa 1, para com a mensagem e não cria nada", () => {
    psql(["-c", BASE], VAZIO);
    expect(() => psql(["-f", ARQUIVO], VAZIO)).toThrow(/Rode antes o SQL da etapa 1/);
    expect(psql(["-c", `SELECT count(*) FROM information_schema.tables WHERE table_schema = '${VAZIO}' AND table_name IN ('servicos_adicionais', 'sync_operacoes')`], VAZIO)).toBe("0");
  });

  it("enums: MEDICAO no tipo de resposta; momento da foto e status de cobrança do adicional", () => {
    const valores = (t: string) => linhas(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = '${t}' ORDER BY e.enumsortorder`);
    expect(valores("TipoRespostaChecklist")).toEqual(["OK_ATENCAO_NA", "MEDICAO"]);
    expect(valores("MomentoFoto")).toEqual(["ANTES", "DEPOIS"]);
    expect(valores("StatusCobrancaAdicional")).toEqual(["A_AVALIAR", "COBRAR", "NAO_COBRAR"]);
  });

  it("colunas, tabelas, índices e chaves com os nomes do Prisma (client_id único), sem tocar nas existentes", () => {
    const cols = (t: string) => ordenadas(`SELECT column_name || ':' || data_type FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${t}' AND column_name IN ('unidade', 'valor', 'audio_url', 'momento', 'client_id')`);
    expect(cols("checklist_tipo_itens")).toEqual(["unidade:text"]);
    expect(cols("checklist_respostas")).toEqual(["audio_url:text", "unidade:text", "valor:numeric"]);
    expect(cols("fotos_atendimento")).toEqual(["client_id:text", "momento:USER-DEFINED"]);
    expect(ordenadas(`SELECT indexname FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexdef LIKE 'CREATE UNIQUE%' AND indexname LIKE '%client_id_key'`))
      .toEqual(["fotos_atendimento_client_id_key", "servicos_adicionais_client_id_key", "servicos_adicionais_fotos_client_id_key"]);
    expect(ordenadas(`SELECT conname || ':' || confdeltype::text FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('servicos_adicionais', 'servicos_adicionais_fotos', 'sync_operacoes')`)).toEqual([
      "servicos_adicionais_atividade_id_fkey:c", "servicos_adicionais_criado_por_id_fkey:n", "servicos_adicionais_empresa_id_fkey:c",
      "servicos_adicionais_equipamento_id_fkey:n", "servicos_adicionais_fotos_criado_por_id_fkey:n", "servicos_adicionais_fotos_empresa_id_fkey:c",
      "servicos_adicionais_fotos_servico_id_fkey:c", "servicos_adicionais_ordem_servico_id_fkey:c", "sync_operacoes_empresa_id_fkey:c", "sync_operacoes_usuario_id_fkey:c",
    ]);
    // a resposta antiga continua lá, intacta
    expect(sql(`SELECT "status" || '|' || "observacao" || '|' || "texto_item" FROM "checklist_respostas" WHERE "id" = 'r-velha'`)).toBe("OK|118/340 psi|Medição de pressão de sucção e de descarga");
  });

  const atual = (tipoWhere: string) => linhas(`SELECT i."ordem" || '|' || i."texto" || '|' || i."tipo_resposta" || '|' || coalesce(i."unidade", '-') || '|' || i."pedir_foto" || '|' || i."pedir_observacao"
    FROM "checklist_tipo_itens" i JOIN "tipos_equipamento_custom" t ON t."id" = i."tipo_equipamento_id" WHERE ${tipoWhere} AND i."ativo" ORDER BY i."ordem"`);
  const esperado = (itens: typeof ITENS_BASE) => itens.map((it, n) => `${n + 1}|${it.texto}|${it.tipoResposta ?? "OK_ATENCAO_NA"}|${it.unidade ?? "-"}|${!!it.pedirFoto}|${!!it.pedirObservacao}`);

  it("checklist de fábrica intacto: as medições viram itens de MEDIÇÃO (número + unidade), na posição, exatamente como o padrão atual", () => {
    for (const e of ["e1", "e2"]) for (const t of TIPOS_PADRAO) {
      if (e === "e2" && t.chave === "CHILLER") continue; // editado: ver o teste abaixo
      expect(atual(`t."empresa_id" = '${e}' AND t."chave_enum" = '${t.chave}'`), `${e} ${t.chave}`).toEqual(esperado(t.itens));
    }
    // personalizado que usou a sugestão da etapa 1 (itens-base) também é atualizado
    expect(atual(`t."id" = 'e2-split'`)).toEqual(esperado(ITENS_BASE));
    expect(esperado(ITENS_BASE).filter((l) => l.includes("|MEDICAO|"))).toEqual([
      "6|Pressão de sucção|MEDICAO|psi|false|false", "7|Pressão de descarga|MEDICAO|psi|false|false",
      "8|Corrente do compressor|MEDICAO|A|false|false", "9|Corrente dos ventiladores|MEDICAO|A|false|false",
      "10|Temperatura de insuflamento|MEDICAO|°C|false|false", "11|Temperatura de retorno|MEDICAO|°C|false|false",
    ]);
  });

  it("as medições antigas são INATIVADAS (nunca apagadas): a resposta já dada continua apontando para o item", () => {
    expect(linhas(`SELECT i."texto" || ':' || i."ativo" FROM "checklist_tipo_itens" i JOIN "tipos_equipamento_custom" t ON t."id" = i."tipo_equipamento_id"
      WHERE t."empresa_id" = 'e1' AND t."chave_enum" = 'AR_CONDICIONADO_SPLIT' AND NOT i."ativo" ORDER BY i."ordem"`)).toEqual([
      "Medição de pressão de sucção e de descarga:false", "Medição de corrente do compressor e dos ventiladores:false",
      "Medição de temperatura de insuflamento e retorno (delta T):false",
    ]);
    expect(sql(`SELECT i."ativo" FROM "checklist_respostas" r JOIN "checklist_tipo_itens" i ON i."id" = r."item_id" WHERE r."id" = 'r-velha'`)).toBe("f");
  });

  it("checklist que a empresa já editou e tipo sem checklist não são tocados", () => {
    const chiller = atual(`t."empresa_id" = 'e2' AND t."chave_enum" = 'CHILLER'`);
    expect(chiller.some((l) => l.includes("Pressostatos (alta, baixa e óleo)"))).toBe(true);
    expect(chiller.some((l) => l.includes("|MEDICAO|"))).toBe(false);
    expect(sql(`SELECT count(*) FROM "checklist_tipo_itens" i JOIN "tipos_equipamento_custom" t ON t."id" = i."tipo_equipamento_id" WHERE t."empresa_id" = 'e2' AND t."chave_enum" = 'CHILLER' AND NOT i."ativo"`)).toBe("0");
    expect(sql(`SELECT count(*) FROM "checklist_tipo_itens" WHERE "tipo_equipamento_id" = 'e2-vazio'`)).toBe("0");
  });

  it("rodar de novo não repete nada", () => {
    expect(sql(`SELECT (SELECT count(*) FROM "checklist_tipo_itens") || '|' || (SELECT count(*) FROM "checklist_tipo_itens" WHERE "ativo")`)).toBe(contagemPrimeira);
  });

  it("integridade: client_id repetido é recusado; medição e status de cobrança tipados; adicional some com a OS", () => {
    sql(`INSERT INTO "ordens_servico" VALUES ('os1')`);
    sql(`INSERT INTO "fotos_atendimento" ("id", "empresa_id", "atividade_id", "equipamento_id", "url", "momento", "client_id") VALUES ('f1', 'e1', 'a1', 'eq1', 'data:image/png;base64,AA==', 'ANTES', 'cli-1')`);
    expect(() => sql(`INSERT INTO "fotos_atendimento" ("id", "empresa_id", "atividade_id", "equipamento_id", "url", "client_id") VALUES ('f2', 'e1', 'a1', 'eq1', 'x', 'cli-1')`))
      .toThrow(/fotos_atendimento_client_id_key/);
    expect(() => sql(`INSERT INTO "fotos_atendimento" ("id", "empresa_id", "atividade_id", "equipamento_id", "url", "momento") VALUES ('f3', 'e1', 'a1', 'eq1', 'x', 'DURANTE')`))
      .toThrow(/invalid input value for enum/);
    sql(`INSERT INTO "servicos_adicionais" ("id", "empresa_id", "ordem_servico_id", "atividade_id", "descricao", "client_id", "atualizado_em") VALUES ('s1', 'e1', 'os1', 'a1', 'Troca do controle remoto', 'cli-s1', now())`);
    expect(sql(`SELECT "status_cobranca" FROM "servicos_adicionais" WHERE "id" = 's1'`)).toBe("A_AVALIAR");
    sql(`INSERT INTO "servicos_adicionais_fotos" ("id", "empresa_id", "servico_id", "url", "client_id") VALUES ('sf1', 'e1', 's1', 'x', 'cli-sf1')`);
    sql(`DELETE FROM "ordens_servico" WHERE "id" = 'os1'`);
    expect(sql(`SELECT (SELECT count(*) FROM "servicos_adicionais") || '|' || (SELECT count(*) FROM "servicos_adicionais_fotos")`)).toBe("0|0");
    sql(`UPDATE "checklist_respostas" SET "valor" = 118.5, "unidade" = 'psi' WHERE "id" = 'r-velha'`);
    expect(sql(`SELECT "valor" || ' ' || "unidade" FROM "checklist_respostas" WHERE "id" = 'r-velha'`)).toBe("118.500 psi");
  });
});
