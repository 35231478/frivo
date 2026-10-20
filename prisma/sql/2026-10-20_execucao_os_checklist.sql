-- Execução da OS repensada — ETAPA 1: tipos de equipamento pré-cadastrados, checklist por tipo,
-- respostas e fotos POR EQUIPAMENTO atendido e observação do equipamento na atividade.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido). Nada é
-- removido; os dados existentes só são COMPLETADOS:
--   1. enum "TipoEquipamento": + PISO_TETO, CASSETE e SELF_CONTAINED (tipos padrão novos);
--   2. enums novos "TipoRespostaChecklist" e "RespostaChecklist";
--   3. tabelas novas:
--      - checklist_tipo_itens: o checklist de cada tipo de equipamento (editável no cadastro do tipo);
--      - checklist_respostas: a resposta de cada item, por equipamento atendido na atividade;
--      - fotos_atendimento: as fotos de cada equipamento atendido (gerais ou de um item);
--   4. atividade_equipamentos + observacao (a observação do técnico sobre aquele equipamento);
--   5. os 8 tipos pré-cadastrados em TODAS as empresas: Split Hi-Wall (parede), Piso-Teto, Cassete,
--      VRF/VRV, Chiller, Self-Contained, Fancoil e Câmara Fria/Refrigeração:
--      - tipo personalizado com o mesmo nome (ex.: "Cassete" criado à mão) é ADOTADO como o padrão,
--        em vez de duplicar (os equipamentos dele passam a usar o tipo novo do enum);
--      - o tipo padrão que ainda não existe na empresa é criado;
--      - o nome de fábrica antigo ("Ar-cond. Split", "VRF", "Fan Coil", "Câmara Fria") só é trocado
--        se a empresa NÃO o renomeou e não há outro tipo ativo com o nome novo;
--   6. equipamentos sem tipo_equipamento_id ganham o do seu tipo (a mesma regra do backfill antigo);
--   7. checklist inicial (rascunho de boas práticas de manutenção preventiva AVAC) nos 8 tipos — só
--      em tipo que ainda não tem NENHUM item: rodar de novo, ou depois que a empresa editar o
--      checklist, não mexe em nada.
-- Índices e chaves estrangeiras com os nomes que o Prisma gera.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-20_execucao_os_checklist.sql

-- Os valores novos do enum vão fora da transação: o PostgreSQL só deixa usá-los depois do commit.
ALTER TYPE "TipoEquipamento" ADD VALUE IF NOT EXISTS 'PISO_TETO';
ALTER TYPE "TipoEquipamento" ADD VALUE IF NOT EXISTS 'CASSETE';
ALTER TYPE "TipoEquipamento" ADD VALUE IF NOT EXISTS 'SELF_CONTAINED';

BEGIN;

DO $$
BEGIN
  IF to_regclass('"tipos_equipamento_custom"') IS NULL OR to_regclass('"atividade_equipamentos"') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas de tipos de equipamento / atividades: este banco não está na versão esperada. Nada foi alterado.';
  END IF;
  IF to_regtype('"TipoRespostaChecklist"') IS NULL THEN
    CREATE TYPE "TipoRespostaChecklist" AS ENUM ('OK_ATENCAO_NA');
  END IF;
  IF to_regtype('"RespostaChecklist"') IS NULL THEN
    CREATE TYPE "RespostaChecklist" AS ENUM ('OK', 'ATENCAO', 'NAO_SE_APLICA');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "checklist_tipo_itens" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo_equipamento_id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "tipo_resposta" "TipoRespostaChecklist" NOT NULL DEFAULT 'OK_ATENCAO_NA',
    "pedir_foto" BOOLEAN NOT NULL DEFAULT false,
    "pedir_observacao" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "checklist_tipo_itens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "checklist_respostas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "atividade_id" TEXT NOT NULL,
    "equipamento_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "status" "RespostaChecklist",
    "observacao" TEXT,
    "texto_item" TEXT NOT NULL,
    "respondido_por_id" TEXT,
    "respondido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "checklist_respostas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "fotos_atendimento" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "atividade_id" TEXT NOT NULL,
    "equipamento_id" TEXT NOT NULL,
    "item_id" TEXT,
    "url" TEXT NOT NULL,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fotos_atendimento_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "atividade_equipamentos" ADD COLUMN IF NOT EXISTS "observacao" TEXT;

CREATE INDEX IF NOT EXISTS "checklist_tipo_itens_tipo_equipamento_id_ativo_ordem_idx" ON "checklist_tipo_itens"("tipo_equipamento_id", "ativo", "ordem");
CREATE INDEX IF NOT EXISTS "checklist_tipo_itens_empresa_id_idx" ON "checklist_tipo_itens"("empresa_id");
CREATE INDEX IF NOT EXISTS "checklist_respostas_equipamento_id_idx" ON "checklist_respostas"("equipamento_id");
CREATE INDEX IF NOT EXISTS "checklist_respostas_item_id_idx" ON "checklist_respostas"("item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "checklist_respostas_atividade_id_equipamento_id_item_id_key" ON "checklist_respostas"("atividade_id", "equipamento_id", "item_id");
CREATE INDEX IF NOT EXISTS "fotos_atendimento_atividade_id_equipamento_id_idx" ON "fotos_atendimento"("atividade_id", "equipamento_id");
CREATE INDEX IF NOT EXISTS "fotos_atendimento_equipamento_id_idx" ON "fotos_atendimento"("equipamento_id");
CREATE INDEX IF NOT EXISTS "fotos_atendimento_item_id_idx" ON "fotos_atendimento"("item_id");

-- Chaves estrangeiras (só as que ainda não existem). A resposta trava a exclusão do item (RESTRICT):
-- o histórico de um checklist respondido nunca some junto com o modelo.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('checklist_tipo_itens', 'checklist_tipo_itens_empresa_id_fkey', 'ALTER TABLE "checklist_tipo_itens" ADD CONSTRAINT "checklist_tipo_itens_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('checklist_tipo_itens', 'checklist_tipo_itens_tipo_equipamento_id_fkey', 'ALTER TABLE "checklist_tipo_itens" ADD CONSTRAINT "checklist_tipo_itens_tipo_equipamento_id_fkey" FOREIGN KEY ("tipo_equipamento_id") REFERENCES "tipos_equipamento_custom"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('checklist_respostas', 'checklist_respostas_empresa_id_fkey', 'ALTER TABLE "checklist_respostas" ADD CONSTRAINT "checklist_respostas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('checklist_respostas', 'checklist_respostas_atividade_id_fkey', 'ALTER TABLE "checklist_respostas" ADD CONSTRAINT "checklist_respostas_atividade_id_fkey" FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('checklist_respostas', 'checklist_respostas_equipamento_id_fkey', 'ALTER TABLE "checklist_respostas" ADD CONSTRAINT "checklist_respostas_equipamento_id_fkey" FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('checklist_respostas', 'checklist_respostas_item_id_fkey', 'ALTER TABLE "checklist_respostas" ADD CONSTRAINT "checklist_respostas_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "checklist_tipo_itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE'),
    ('checklist_respostas', 'checklist_respostas_respondido_por_id_fkey', 'ALTER TABLE "checklist_respostas" ADD CONSTRAINT "checklist_respostas_respondido_por_id_fkey" FOREIGN KEY ("respondido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('fotos_atendimento', 'fotos_atendimento_empresa_id_fkey', 'ALTER TABLE "fotos_atendimento" ADD CONSTRAINT "fotos_atendimento_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('fotos_atendimento', 'fotos_atendimento_atividade_id_fkey', 'ALTER TABLE "fotos_atendimento" ADD CONSTRAINT "fotos_atendimento_atividade_id_fkey" FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('fotos_atendimento', 'fotos_atendimento_equipamento_id_fkey', 'ALTER TABLE "fotos_atendimento" ADD CONSTRAINT "fotos_atendimento_equipamento_id_fkey" FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('fotos_atendimento', 'fotos_atendimento_item_id_fkey', 'ALTER TABLE "fotos_atendimento" ADD CONSTRAINT "fotos_atendimento_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "checklist_tipo_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('fotos_atendimento', 'fotos_atendimento_criado_por_id_fkey', 'ALTER TABLE "fotos_atendimento" ADD CONSTRAINT "fotos_atendimento_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE')
  ) AS t(tabela, nome, ddl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome AND conrelid = format('%I', fk.tabela)::regclass) THEN
      EXECUTE fk.ddl;
    END IF;
  END LOOP;
END $$;

-- ───── 5. Os 8 tipos pré-cadastrados (chave do enum, nome, nome de fábrica antigo) ─────
CREATE TEMP TABLE "_tipos_padrao" ("chave" TEXT, "nome" TEXT, "nome_antigo" TEXT) ON COMMIT DROP;
INSERT INTO "_tipos_padrao" VALUES
    ('AR_CONDICIONADO_SPLIT', 'Split Hi-Wall (parede)', 'Ar-cond. Split'),
    ('PISO_TETO', 'Piso-Teto', NULL),
    ('CASSETE', 'Cassete', NULL),
    ('VRF', 'VRF/VRV', 'VRF'),
    ('CHILLER', 'Chiller', NULL),
    ('SELF_CONTAINED', 'Self-Contained', NULL),
    ('FANCOIL', 'Fancoil', 'Fan Coil'),
    ('CAMARA_FRIA', 'Câmara Fria/Refrigeração', 'Câmara Fria');

-- 5a. Tipo personalizado com o mesmo nome — o novo ou o antigo de fábrica (ex.: "VRF" → VRF/VRV), sem
--     diferenciar maiúsculas, espaços e pontuação — vira o padrão (mantém id, equipamentos e formulários)
UPDATE "tipos_equipamento_custom" t SET "chave_enum" = alvo."chave"
FROM (
  SELECT DISTINCT ON (c."empresa_id", p."chave") c."id", p."chave"
  FROM "tipos_equipamento_custom" c
  JOIN "_tipos_padrao" p ON regexp_replace(lower(c."nome"), '[^[:alnum:]]', '', 'g')
    IN (regexp_replace(lower(p."nome"), '[^[:alnum:]]', '', 'g'), regexp_replace(lower(coalesce(p."nome_antigo", p."nome")), '[^[:alnum:]]', '', 'g'))
  WHERE c."chave_enum" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "tipos_equipamento_custom" x WHERE x."empresa_id" = c."empresa_id" AND x."chave_enum" = p."chave")
  ORDER BY c."empresa_id", p."chave", c."ativo" DESC, c."criado_em"
) alvo
WHERE t."id" = alvo."id";

-- 5b. O tipo padrão que a empresa ainda não tem é criado
INSERT INTO "tipos_equipamento_custom" ("id", "empresa_id", "nome", "chave_enum", "ativo", "criado_em")
SELECT gen_random_uuid()::text, e."id", p."nome", p."chave", true, now()
FROM "empresas" e CROSS JOIN "_tipos_padrao" p
WHERE NOT EXISTS (SELECT 1 FROM "tipos_equipamento_custom" t WHERE t."empresa_id" = e."id" AND t."chave_enum" = p."chave");

-- 5c. Nome de fábrica antigo → nome novo (só se a empresa não renomeou e o nome novo está livre)
UPDATE "tipos_equipamento_custom" t SET "nome" = p."nome"
FROM "_tipos_padrao" p
WHERE t."chave_enum" = p."chave" AND p."nome_antigo" IS NOT NULL AND t."nome" = p."nome_antigo"
  AND NOT EXISTS (
    SELECT 1 FROM "tipos_equipamento_custom" x
    WHERE x."empresa_id" = t."empresa_id" AND x."id" <> t."id" AND x."ativo" AND lower(btrim(x."nome")) = lower(p."nome")
  );

-- ───── 6. Equipamentos: o tipo (FK) que faltava e o enum dos tipos adotados ─────
UPDATE "equipamentos" e SET "tipo_equipamento_id" = t."id"
FROM "tipos_equipamento_custom" t
WHERE e."tipo_equipamento_id" IS NULL AND t."empresa_id" = e."empresa_id" AND t."chave_enum" = e."tipo"::text;

UPDATE "equipamentos" e SET "tipo" = t."chave_enum"::"TipoEquipamento"
FROM "tipos_equipamento_custom" t
WHERE e."tipo_equipamento_id" = t."id" AND e."tipo" = 'OUTRO' AND t."chave_enum" IN ('PISO_TETO', 'CASSETE', 'SELF_CONTAINED');

-- ───── 7. Checklist inicial dos 8 tipos (só em tipo ainda sem nenhum item) ─────
CREATE TEMP TABLE "_itens_padrao" ("chave" TEXT, "ordem" INTEGER, "texto" TEXT, "pedir_foto" BOOLEAN, "pedir_observacao" BOOLEAN) ON COMMIT DROP;
INSERT INTO "_itens_padrao" VALUES
    ('AR_CONDICIONADO_SPLIT', 1, 'Limpeza dos filtros de ar', true, false),
    ('AR_CONDICIONADO_SPLIT', 2, 'Limpeza da serpentina evaporadora', true, false),
    ('AR_CONDICIONADO_SPLIT', 3, 'Limpeza da serpentina condensadora', false, false),
    ('AR_CONDICIONADO_SPLIT', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', false, false),
    ('AR_CONDICIONADO_SPLIT', 5, 'Carga de gás refrigerante e verificação de vazamentos', false, false),
    ('AR_CONDICIONADO_SPLIT', 6, 'Medição de pressão de sucção e de descarga', false, true),
    ('AR_CONDICIONADO_SPLIT', 7, 'Medição de corrente do compressor e dos ventiladores', false, true),
    ('AR_CONDICIONADO_SPLIT', 8, 'Medição de temperatura de insuflamento e retorno (delta T)', false, true),
    ('AR_CONDICIONADO_SPLIT', 9, 'Conexões elétricas, contatora e disjuntor: aperto e estado', false, false),
    ('AR_CONDICIONADO_SPLIT', 10, 'Estado dos motores, hélices e turbinas', false, false),
    ('AR_CONDICIONADO_SPLIT', 11, 'Estado do isolamento térmico das tubulações', false, false),
    ('AR_CONDICIONADO_SPLIT', 12, 'Ruídos e vibrações anormais', false, false),
    ('AR_CONDICIONADO_SPLIT', 13, 'Teste de funcionamento (liga/desliga, termostato e controle)', false, false),
    ('AR_CONDICIONADO_SPLIT', 14, 'Fixação e estrutura (suportes, base e parafusos)', false, false),
    ('PISO_TETO', 1, 'Limpeza dos filtros de ar', true, false),
    ('PISO_TETO', 2, 'Limpeza da serpentina evaporadora', true, false),
    ('PISO_TETO', 3, 'Limpeza da serpentina condensadora', false, false),
    ('PISO_TETO', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', false, false),
    ('PISO_TETO', 5, 'Bomba de drenagem e mangueira de dreno', false, false),
    ('PISO_TETO', 6, 'Aletas e defletores de ar (movimento e estado)', false, false),
    ('PISO_TETO', 7, 'Carga de gás refrigerante e verificação de vazamentos', false, false),
    ('PISO_TETO', 8, 'Medição de pressão de sucção e de descarga', false, true),
    ('PISO_TETO', 9, 'Medição de corrente do compressor e dos ventiladores', false, true),
    ('PISO_TETO', 10, 'Medição de temperatura de insuflamento e retorno (delta T)', false, true),
    ('PISO_TETO', 11, 'Conexões elétricas, contatora e disjuntor: aperto e estado', false, false),
    ('PISO_TETO', 12, 'Estado dos motores, hélices e turbinas', false, false),
    ('PISO_TETO', 13, 'Estado do isolamento térmico das tubulações', false, false),
    ('PISO_TETO', 14, 'Ruídos e vibrações anormais', false, false),
    ('PISO_TETO', 15, 'Teste de funcionamento (liga/desliga, termostato e controle)', false, false),
    ('PISO_TETO', 16, 'Fixação e estrutura (suportes, base e parafusos)', false, false),
    ('CASSETE', 1, 'Limpeza dos filtros de ar', true, false),
    ('CASSETE', 2, 'Limpeza da serpentina evaporadora', true, false),
    ('CASSETE', 3, 'Limpeza da serpentina condensadora', false, false),
    ('CASSETE', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', false, false),
    ('CASSETE', 5, 'Bomba de drenagem e mangueira de dreno', false, false),
    ('CASSETE', 6, 'Aletas e defletores de ar (movimento e estado)', false, false),
    ('CASSETE', 7, 'Carga de gás refrigerante e verificação de vazamentos', false, false),
    ('CASSETE', 8, 'Medição de pressão de sucção e de descarga', false, true),
    ('CASSETE', 9, 'Medição de corrente do compressor e dos ventiladores', false, true),
    ('CASSETE', 10, 'Medição de temperatura de insuflamento e retorno (delta T)', false, true),
    ('CASSETE', 11, 'Conexões elétricas, contatora e disjuntor: aperto e estado', false, false),
    ('CASSETE', 12, 'Estado dos motores, hélices e turbinas', false, false),
    ('CASSETE', 13, 'Estado do isolamento térmico das tubulações', false, false),
    ('CASSETE', 14, 'Ruídos e vibrações anormais', false, false),
    ('CASSETE', 15, 'Teste de funcionamento (liga/desliga, termostato e controle)', false, false),
    ('CASSETE', 16, 'Fixação e estrutura (suportes, base e parafusos)', false, false),
    ('VRF', 1, 'Limpeza dos filtros de ar', true, false),
    ('VRF', 2, 'Limpeza da serpentina evaporadora', true, false),
    ('VRF', 3, 'Limpeza da serpentina condensadora', false, false),
    ('VRF', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', false, false),
    ('VRF', 5, 'Carga de gás refrigerante e verificação de vazamentos', false, false),
    ('VRF', 6, 'Medição de pressão de sucção e de descarga', false, true),
    ('VRF', 7, 'Pressões por circuito', false, true),
    ('VRF', 8, 'Medição de corrente do compressor e dos ventiladores', false, true),
    ('VRF', 9, 'Medição de temperatura de insuflamento e retorno (delta T)', false, true),
    ('VRF', 10, 'Conexões elétricas, contatora e disjuntor: aperto e estado', false, false),
    ('VRF', 11, 'Estado dos motores, hélices e turbinas', false, false),
    ('VRF', 12, 'Estado do isolamento térmico das tubulações', false, false),
    ('VRF', 13, 'Ruídos e vibrações anormais', false, false),
    ('VRF', 14, 'Teste de funcionamento (liga/desliga, termostato e controle)', false, false),
    ('VRF', 15, 'Erros e alarmes no controlador central', false, false),
    ('VRF', 16, 'Comunicação entre as unidades internas e externas', false, false),
    ('VRF', 17, 'Fixação e estrutura (suportes, base e parafusos)', false, false),
    ('CHILLER', 1, 'Limpeza da serpentina condensadora', false, false),
    ('CHILLER', 2, 'Fluxo de água e bomba (vazão e fluxostato)', false, false),
    ('CHILLER', 3, 'Pressostatos de alta e de baixa', false, false),
    ('CHILLER', 4, 'Carga de gás refrigerante e verificação de vazamentos', false, false),
    ('CHILLER', 5, 'Medição de pressão de sucção e de descarga', false, true),
    ('CHILLER', 6, 'Medição de corrente do compressor e dos ventiladores', false, true),
    ('CHILLER', 7, 'Temperatura de entrada e saída de água (delta T)', false, true),
    ('CHILLER', 8, 'Conexões elétricas, contatora e disjuntor: aperto e estado', false, false),
    ('CHILLER', 9, 'Estado dos motores, hélices e turbinas', false, false),
    ('CHILLER', 10, 'Estado do isolamento térmico das tubulações', false, false),
    ('CHILLER', 11, 'Ruídos e vibrações anormais', false, false),
    ('CHILLER', 12, 'Teste de funcionamento (liga/desliga, termostato e controle)', false, false),
    ('CHILLER', 13, 'Fixação e estrutura (suportes, base e parafusos)', false, false),
    ('SELF_CONTAINED', 1, 'Limpeza dos filtros de ar', true, false),
    ('SELF_CONTAINED', 2, 'Limpeza da serpentina evaporadora', true, false),
    ('SELF_CONTAINED', 3, 'Limpeza da serpentina condensadora', false, false),
    ('SELF_CONTAINED', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', false, false),
    ('SELF_CONTAINED', 5, 'Carga de gás refrigerante e verificação de vazamentos', false, false),
    ('SELF_CONTAINED', 6, 'Medição de pressão de sucção e de descarga', false, true),
    ('SELF_CONTAINED', 7, 'Pressostatos de alta e de baixa', false, false),
    ('SELF_CONTAINED', 8, 'Medição de corrente do compressor e dos ventiladores', false, true),
    ('SELF_CONTAINED', 9, 'Medição de temperatura de insuflamento e retorno (delta T)', false, true),
    ('SELF_CONTAINED', 10, 'Fluxo de água e bomba de condensação (quando a condensação é a água)', false, false),
    ('SELF_CONTAINED', 11, 'Conexões elétricas, contatora e disjuntor: aperto e estado', false, false),
    ('SELF_CONTAINED', 12, 'Estado dos motores, hélices e turbinas', false, false),
    ('SELF_CONTAINED', 13, 'Estado do isolamento térmico das tubulações', false, false),
    ('SELF_CONTAINED', 14, 'Ruídos e vibrações anormais', false, false),
    ('SELF_CONTAINED', 15, 'Teste de funcionamento (liga/desliga, termostato e controle)', false, false),
    ('SELF_CONTAINED', 16, 'Fixação e estrutura (suportes, base e parafusos)', false, false),
    ('FANCOIL', 1, 'Limpeza dos filtros de ar', true, false),
    ('FANCOIL', 2, 'Limpeza da serpentina de água gelada', true, false),
    ('FANCOIL', 3, 'Dreno e bandeja: limpeza e verificação de vazamento de água', false, false),
    ('FANCOIL', 4, 'Válvula de controle de água gelada (2 ou 3 vias)', false, false),
    ('FANCOIL', 5, 'Temperatura de entrada e saída de água (delta T)', false, true),
    ('FANCOIL', 6, 'Medição de temperatura de insuflamento e retorno (delta T)', false, true),
    ('FANCOIL', 7, 'Medição de corrente do motor do ventilador', false, true),
    ('FANCOIL', 8, 'Correias e polias (tensão e desgaste)', false, false),
    ('FANCOIL', 9, 'Conexões elétricas, contatora e disjuntor: aperto e estado', false, false),
    ('FANCOIL', 10, 'Estado dos motores, hélices e turbinas', false, false),
    ('FANCOIL', 11, 'Estado do isolamento térmico das tubulações', false, false),
    ('FANCOIL', 12, 'Ruídos e vibrações anormais', false, false),
    ('FANCOIL', 13, 'Teste de funcionamento (liga/desliga, termostato e controle)', false, false),
    ('FANCOIL', 14, 'Fixação e estrutura (suportes, base e parafusos)', false, false),
    ('CAMARA_FRIA', 1, 'Limpeza da serpentina evaporadora', true, false),
    ('CAMARA_FRIA', 2, 'Limpeza da serpentina condensadora', false, false),
    ('CAMARA_FRIA', 3, 'Dreno e bandeja: limpeza e verificação de vazamento de água', false, false),
    ('CAMARA_FRIA', 4, 'Carga de gás refrigerante e verificação de vazamentos', false, false),
    ('CAMARA_FRIA', 5, 'Medição de pressão de sucção e de descarga', false, true),
    ('CAMARA_FRIA', 6, 'Medição de corrente do compressor e dos ventiladores', false, true),
    ('CAMARA_FRIA', 7, 'Pressostatos de alta e de baixa', false, false),
    ('CAMARA_FRIA', 8, 'Controle de temperatura da câmara (setpoint e temperatura medida)', false, true),
    ('CAMARA_FRIA', 9, 'Degelo (resistências, ciclo e termostato de degelo)', false, false),
    ('CAMARA_FRIA', 10, 'Gaxetas e vedação da porta', false, false),
    ('CAMARA_FRIA', 11, 'Conexões elétricas, contatora e disjuntor: aperto e estado', false, false),
    ('CAMARA_FRIA', 12, 'Estado dos motores, hélices e turbinas', false, false),
    ('CAMARA_FRIA', 13, 'Estado do isolamento térmico das tubulações', false, false),
    ('CAMARA_FRIA', 14, 'Ruídos e vibrações anormais', false, false),
    ('CAMARA_FRIA', 15, 'Teste de funcionamento (liga/desliga, termostato e controle)', false, false),
    ('CAMARA_FRIA', 16, 'Fixação e estrutura (suportes, base e parafusos)', false, false);

INSERT INTO "checklist_tipo_itens" ("id", "empresa_id", "tipo_equipamento_id", "texto", "tipo_resposta", "pedir_foto", "pedir_observacao", "ordem", "ativo", "criado_em", "atualizado_em")
SELECT gen_random_uuid()::text, t."empresa_id", t."id", i."texto", 'OK_ATENCAO_NA', i."pedir_foto", i."pedir_observacao", i."ordem", true, now(), now()
FROM "tipos_equipamento_custom" t
JOIN "_itens_padrao" i ON i."chave" = t."chave_enum"
WHERE NOT EXISTS (SELECT 1 FROM "checklist_tipo_itens" x WHERE x."tipo_equipamento_id" = t."id");

COMMIT;
