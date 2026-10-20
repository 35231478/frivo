/**
 * Execução da OS — etapa 1: o SQL de produção (prisma/sql/2026-10-20_execucao_os_checklist.sql)
 * rodado de verdade num PostgreSQL, num schema descartável com as tabelas como estão HOJE e dados
 * que cobrem os casos difíceis (tipo renomeado pela empresa, personalizado com o mesmo nome, nome
 * novo já em uso, checklist já editado). Roda o arquivo DUAS vezes e confere.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-execucao-os-checklist
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { TIPOS_PADRAO } from "@/lib/checklist/padrao";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-10-20_execucao_os_checklist.sql");
const SCHEMA = `teste_exec_os_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const linhas = (q: string) => sql(q).split("\n").filter(Boolean);

const ENUM_HOJE = ["AR_CONDICIONADO_SPLIT", "AR_CONDICIONADO_JANELA", "AR_CONDICIONADO_CENTRAL", "AR_CONDICIONADO_PORTATIL", "CHILLER", "TORRE_RESFRIAMENTO",
  "CAMARA_FRIA", "CAMARA_CLIMATIZADA", "REFRIGERADOR_COMERCIAL", "CONGELADOR_COMERCIAL", "VRF", "FANCOIL", "CONDENSADORA", "EVAPORADORA", "OUTRO"];

describe.skipIf(!URL)("SQL de produção: execução da OS — tipos, checklist por tipo, respostas e fotos (PostgreSQL real)", () => {
  let contagemPrimeira = "";

  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TYPE "TipoEquipamento" AS ENUM (${ENUM_HOJE.map((v) => `'${v}'`).join(", ")});
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "tipos_equipamento_custom" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL REFERENCES "empresas"("id"), "nome" TEXT NOT NULL,
        "descricao" TEXT, "chave_enum" TEXT, "ativo" BOOLEAN NOT NULL DEFAULT true, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT now());
      CREATE TABLE "equipamentos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "tipo" "TipoEquipamento" NOT NULL, "tipo_equipamento_id" TEXT);
      CREATE TABLE "atividades_os" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "atividade_equipamentos" ("id" TEXT PRIMARY KEY, "atividade_id" TEXT NOT NULL, "equipamento_id" TEXT NOT NULL,
        "feito" BOOLEAN NOT NULL DEFAULT false, "feito_em" TIMESTAMP(3), "criado_em" TIMESTAMP(3) NOT NULL DEFAULT now());
      INSERT INTO "empresas" VALUES ('e1'), ('e2'), ('e3'), ('e4');
      -- e1: tipos padrão com o nome de fábrica (backfill antigo) + "cassete" criado à mão, com equipamento
      INSERT INTO "tipos_equipamento_custom" ("id", "empresa_id", "nome", "chave_enum", "criado_em") VALUES
        ('e1-split', 'e1', 'Ar-cond. Split', 'AR_CONDICIONADO_SPLIT', now()), ('e1-vrf', 'e1', 'VRF', 'VRF', now()),
        ('e1-fan', 'e1', 'Fan Coil', 'FANCOIL', now()), ('e1-cam', 'e1', 'Câmara Fria', 'CAMARA_FRIA', now()),
        ('e1-chiller', 'e1', 'Chiller', 'CHILLER', now()), ('e1-janela', 'e1', 'Ar-cond. Janela', 'AR_CONDICIONADO_JANELA', now()),
        ('e1-cassete', 'e1', 'cassete', NULL, now() - interval '1 day');
      -- e2: renomeou o Split; já tem um "VRF/VRV" ativo personalizado; o Chiller já tem checklist (item removido)
      INSERT INTO "tipos_equipamento_custom" ("id", "empresa_id", "nome", "chave_enum") VALUES
        ('e2-split', 'e2', 'Split 9000 BTU', 'AR_CONDICIONADO_SPLIT'), ('e2-vrf', 'e2', 'VRF', 'VRF'),
        ('e2-vrfvrv', 'e2', 'VRF/VRV', NULL), ('e2-chiller', 'e2', 'Chiller', 'CHILLER');
      -- e3: nenhum tipo ainda
      -- e4: criou à mão "VRF" e "Fan coil" (os nomes ANTIGOS de fábrica), sem chave, com equipamento
      INSERT INTO "tipos_equipamento_custom" ("id", "empresa_id", "nome", "chave_enum") VALUES ('e4-vrf', 'e4', 'VRF', NULL), ('e4-fan', 'e4', 'Fan coil', NULL);
      INSERT INTO "equipamentos" VALUES ('eq-cas', 'e1', 'OUTRO', 'e1-cassete'), ('eq-chi', 'e1', 'CHILLER', NULL), ('eq-out', 'e1', 'OUTRO', NULL),
        ('eq-vrf4', 'e4', 'VRF', 'e4-vrf');
    `);
    // o checklist do Chiller da e2 "já existia" (tabela criada por uma rodada anterior, item inativado pela empresa)
    psql(["-f", ARQUIVO]);
    contagemPrimeira = sql(`SELECT count(*) || '|' || (SELECT count(*) FROM "tipos_equipamento_custom") FROM "checklist_tipo_itens"`);
    sql(`DELETE FROM "checklist_tipo_itens" WHERE "tipo_equipamento_id" = 'e2-chiller';
         INSERT INTO "checklist_tipo_itens" ("id", "empresa_id", "tipo_equipamento_id", "texto", "ativo", "atualizado_em") VALUES ('meu-item', 'e2', 'e2-chiller', 'Item da empresa', false, now());`);
    psql(["-f", ARQUIVO]); // 2ª vez: não pode falhar nem repetir nada
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("enum de tipos ganha Piso-Teto, Cassete e Self-Contained (uma vez só); enums novos do checklist", () => {
    expect(linhas(`SELECT unnest(enum_range(NULL::"TipoEquipamento"))::text`)).toEqual([...ENUM_HOJE, "PISO_TETO", "CASSETE", "SELF_CONTAINED"]);
    expect(linhas(`SELECT unnest(enum_range(NULL::"RespostaChecklist"))::text`)).toEqual(["OK", "ATENCAO", "NAO_SE_APLICA"]);
    expect(linhas(`SELECT unnest(enum_range(NULL::"TipoRespostaChecklist"))::text`)).toEqual(["OK_ATENCAO_NA"]);
  });

  it("tabelas, coluna, índices e chaves com os nomes do Prisma; a resposta trava a exclusão do item", () => {
    expect(linhas(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${SCHEMA}' AND table_name IN ('checklist_tipo_itens', 'checklist_respostas', 'fotos_atendimento') ORDER BY 1`))
      .toEqual(["checklist_respostas", "checklist_tipo_itens", "fotos_atendimento"]);
    expect(sql(`SELECT data_type || ':' || is_nullable FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'atividade_equipamentos' AND column_name = 'observacao'`)).toBe("text:YES");
    expect(linhas(`SELECT indexname FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename IN ('checklist_tipo_itens', 'checklist_respostas', 'fotos_atendimento') AND indexname NOT LIKE '%pkey' ORDER BY 1`)).toEqual([
      "checklist_respostas_atividade_id_equipamento_id_item_id_key", "checklist_respostas_equipamento_id_idx", "checklist_respostas_item_id_idx",
      "checklist_tipo_itens_empresa_id_idx", "checklist_tipo_itens_tipo_equipamento_id_ativo_ordem_idx",
      "fotos_atendimento_atividade_id_equipamento_id_idx", "fotos_atendimento_equipamento_id_idx", "fotos_atendimento_item_id_idx",
    ]);
    // a=no action, c=cascade, n=set null, r=restrict
    expect(linhas(`SELECT conname || ':' || confdeltype::text FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('checklist_tipo_itens', 'checklist_respostas', 'fotos_atendimento') ORDER BY 1`)).toEqual([
      "checklist_respostas_atividade_id_fkey:c", "checklist_respostas_empresa_id_fkey:c", "checklist_respostas_equipamento_id_fkey:c",
      "checklist_respostas_item_id_fkey:r", "checklist_respostas_respondido_por_id_fkey:n",
      "checklist_tipo_itens_empresa_id_fkey:c", "checklist_tipo_itens_tipo_equipamento_id_fkey:c",
      "fotos_atendimento_atividade_id_fkey:c", "fotos_atendimento_criado_por_id_fkey:n", "fotos_atendimento_empresa_id_fkey:c",
      "fotos_atendimento_equipamento_id_fkey:c", "fotos_atendimento_item_id_fkey:n",
    ]);
  });

  it("os 8 tipos em todas as empresas: nome de fábrica trocado, nome da empresa mantido, personalizado adotado, nada duplicado", () => {
    const tipos = (e: string) => linhas(`SELECT coalesce("chave_enum", '-') || '=' || "nome" FROM "tipos_equipamento_custom" WHERE "empresa_id" = '${e}' ORDER BY 1`);
    expect(tipos("e1")).toEqual([
      "AR_CONDICIONADO_JANELA=Ar-cond. Janela", // fora dos 8: não muda
      "AR_CONDICIONADO_SPLIT=Split Hi-Wall (parede)", "CAMARA_FRIA=Câmara Fria/Refrigeração",
      "CASSETE=cassete", // o "cassete" da empresa virou o padrão (o nome dela fica)
      "CHILLER=Chiller", "FANCOIL=Fancoil", "PISO_TETO=Piso-Teto", "SELF_CONTAINED=Self-Contained", "VRF=VRF/VRV",
    ]);
    expect(tipos("e2")).toEqual([
      "-=VRF/VRV", // personalizado; havia um VRF padrão, então não foi adotado
      "AR_CONDICIONADO_SPLIT=Split 9000 BTU", // renomeado pela empresa: mantido
      "CAMARA_FRIA=Câmara Fria/Refrigeração", "CASSETE=Cassete", "CHILLER=Chiller", "FANCOIL=Fancoil", "PISO_TETO=Piso-Teto", "SELF_CONTAINED=Self-Contained",
      "VRF=VRF", // o nome novo já estava em uso por outro tipo ativo: não renomeia
    ]);
    expect(tipos("e3")).toEqual(TIPOS_PADRAO.map((t) => `${t.chave}=${t.nome}`).sort());
    // Nome antigo de fábrica também é adotado (o mesmo tipo, com os equipamentos dele): nada de "VRF" + "VRF/VRV"
    expect(linhas(`SELECT "id" || '=' || coalesce("chave_enum", '-') || '=' || "nome" FROM "tipos_equipamento_custom" WHERE "empresa_id" = 'e4' AND "id" LIKE 'e4-%' ORDER BY 1`))
      .toEqual(["e4-fan=FANCOIL=Fan coil", "e4-vrf=VRF=VRF/VRV"]); // "Fan coil" é a grafia da empresa: fica
    expect(tipos("e4").filter((t) => t.includes("VRF") || t.includes("FANCOIL"))).toEqual(["FANCOIL=Fan coil", "VRF=VRF/VRV"]);
    expect(sql(`SELECT "tipo_equipamento_id" FROM "equipamentos" WHERE "id" = 'eq-vrf4'`)).toBe("e4-vrf");
  });

  it("equipamentos: o tipo que faltava é preenchido; o do tipo adotado passa ao enum novo", () => {
    expect(linhas(`SELECT "id" || ':' || "tipo" || ':' || coalesce("tipo_equipamento_id", '-') FROM "equipamentos" ORDER BY 1`)).toEqual([
      "eq-cas:CASSETE:e1-cassete", "eq-chi:CHILLER:e1-chiller", `eq-out:OUTRO:-`, // e1 não tem tipo "Outro": fica sem FK, como antes
      "eq-vrf4:VRF:e4-vrf",
    ]);
  });

  it("checklist inicial: cada um dos 8 tipos recebe EXATAMENTE os itens do rascunho, na ordem, com foto/observação", () => {
    for (const e of ["e1", "e3"]) for (const t of TIPOS_PADRAO) {
      const obtido = linhas(`SELECT i."ordem" || '|' || i."texto" || '|' || i."pedir_foto" || '|' || i."pedir_observacao" || '|' || i."tipo_resposta" || '|' || i."ativo"
        FROM "checklist_tipo_itens" i JOIN "tipos_equipamento_custom" t ON t."id" = i."tipo_equipamento_id"
        WHERE t."empresa_id" = '${e}' AND t."chave_enum" = '${t.chave}' ORDER BY i."ordem"`);
      expect(obtido, `${e} ${t.chave}`).toEqual(t.itens.map((it, n) => `${n + 1}|${it.texto}|${!!it.pedirFoto}|${!!it.pedirObservacao}|OK_ATENCAO_NA|true`));
    }
    // fora dos 8 (Janela) e personalizados não ganham checklist
    expect(sql(`SELECT count(*) FROM "checklist_tipo_itens" WHERE "tipo_equipamento_id" IN ('e1-janela', 'e2-vrfvrv')`)).toBe("0");
  });

  it("rodar de novo não repete nada e não mexe em checklist já editado pela empresa", () => {
    const [itens1, tipos1] = contagemPrimeira.split("|").map(Number);
    const chillerPadrao = TIPOS_PADRAO.find((t) => t.chave === "CHILLER")!.itens.length;
    expect(Number(sql(`SELECT count(*) FROM "tipos_equipamento_custom"`))).toBe(tipos1);
    expect(Number(sql(`SELECT count(*) FROM "checklist_tipo_itens"`))).toBe(itens1 - chillerPadrao + 1);
    expect(linhas(`SELECT "id" || ':' || "ativo" FROM "checklist_tipo_itens" WHERE "tipo_equipamento_id" = 'e2-chiller'`)).toEqual(["meu-item:false"]);
  });

  it("integridade: resposta trava excluir o item; foto de item excluído vira foto geral; resposta repetida é recusada", () => {
    sql(`INSERT INTO "atividades_os" VALUES ('a1'); INSERT INTO "usuarios" VALUES ('u1');`);
    const item = sql(`SELECT "id" FROM "checklist_tipo_itens" WHERE "tipo_equipamento_id" = 'e1-chiller' ORDER BY "ordem" LIMIT 1`);
    const outro = sql(`SELECT "id" FROM "checklist_tipo_itens" WHERE "tipo_equipamento_id" = 'e1-chiller' ORDER BY "ordem" OFFSET 1 LIMIT 1`);
    sql(`INSERT INTO "checklist_respostas" ("id", "empresa_id", "atividade_id", "equipamento_id", "item_id", "status", "texto_item", "respondido_por_id", "atualizado_em")
         VALUES ('r1', 'e1', 'a1', 'eq-chi', '${item}', 'OK', 'x', 'u1', now())`);
    expect(() => sql(`INSERT INTO "checklist_respostas" ("id", "empresa_id", "atividade_id", "equipamento_id", "item_id", "texto_item", "atualizado_em")
         VALUES ('r2', 'e1', 'a1', 'eq-chi', '${item}', 'x', now())`)).toThrow(/checklist_respostas_atividade_id_equipamento_id_item_id_key/);
    expect(() => sql(`DELETE FROM "checklist_tipo_itens" WHERE "id" = '${item}'`)).toThrow(/checklist_respostas_item_id_fkey/);
    sql(`INSERT INTO "fotos_atendimento" ("id", "empresa_id", "atividade_id", "equipamento_id", "item_id", "url") VALUES ('f1', 'e1', 'a1', 'eq-chi', '${outro}', 'data:image/png;base64,AA==')`);
    sql(`DELETE FROM "checklist_tipo_itens" WHERE "id" = '${outro}'`);
    expect(sql(`SELECT coalesce("item_id", 'geral') FROM "fotos_atendimento" WHERE "id" = 'f1'`)).toBe("geral");
    expect(() => sql(`INSERT INTO "checklist_respostas" ("id", "empresa_id", "atividade_id", "equipamento_id", "item_id", "status", "texto_item", "atualizado_em")
         VALUES ('r3', 'e1', 'a1', 'eq-chi', '${item}', 'TALVEZ', 'x', now())`)).toThrow(/invalid input value for enum/);
  });
});
