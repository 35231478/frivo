-- Execução da OS repensada — ETAPA 2: o APP DO TÉCNICO (offline-first).
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido). Nada é apagado.
-- Depende do SQL da etapa 1 (prisma/sql/2026-10-20_execucao_os_checklist.sql) — se ele não rodou,
-- este para antes de mexer em qualquer coisa.
--   1. enum "TipoRespostaChecklist" + MEDICAO: item de checklist que só CAPTURA número + unidade;
--      enums novos "MomentoFoto" (ANTES/DEPOIS) e "StatusCobrancaAdicional" (A_AVALIAR/COBRAR/NAO_COBRAR);
--   2. checklist_tipo_itens + unidade (a unidade padrão da medição: psi, °C, A…);
--   3. checklist_respostas + valor, unidade (a medição capturada) e audio_url (observação em áudio,
--      quando o técnico estava sem sinal para ditar);
--   4. fotos_atendimento + momento (antes/depois do equipamento) e client_id (id gerado no aparelho:
--      a foto enviada de novo depois de uma queda de sinal não duplica);
--   5. tabelas novas:
--      - servicos_adicionais (+ servicos_adicionais_fotos): o serviço a mais pedido na visita, na
--        MESMA OS, destacado como "Adicional" no relatório e com status de cobrança para o adm;
--      - sync_operacoes: as operações do app já aplicadas (o reenvio devolve o mesmo resultado);
--   6. checklists de fábrica: nos tipos cujo checklist AINDA É EXATAMENTE o semeado na etapa 1 (mesmos
--      itens, na mesma ordem, com as mesmas opções), os itens "Medição de …" viram itens de MEDIÇÃO
--      (ex.: "Medição de pressão de sucção e de descarga" → "Pressão de sucção" psi + "Pressão de
--      descarga" psi). As antigas são INATIVADAS (as respostas já dadas continuam no histórico e nos
--      relatórios); checklist que a empresa já editou não é tocado.
-- Índices e chaves estrangeiras com os nomes que o Prisma gera.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-21_app_tecnico.sql

DO $$
BEGIN
  IF to_regtype('"TipoRespostaChecklist"') IS NULL OR to_regclass('"checklist_respostas"') IS NULL OR to_regclass('"fotos_atendimento"') IS NULL THEN
    RAISE EXCEPTION 'Rode antes o SQL da etapa 1 (prisma/sql/2026-10-20_execucao_os_checklist.sql): faltam as tabelas do checklist por equipamento. Nada foi alterado.';
  END IF;
END $$;

-- O valor novo do enum vai fora da transação: o PostgreSQL só deixa usá-lo depois do commit.
ALTER TYPE "TipoRespostaChecklist" ADD VALUE IF NOT EXISTS 'MEDICAO';

BEGIN;

DO $$
BEGIN
  IF to_regtype('"MomentoFoto"') IS NULL THEN
    CREATE TYPE "MomentoFoto" AS ENUM ('ANTES', 'DEPOIS');
  END IF;
  IF to_regtype('"StatusCobrancaAdicional"') IS NULL THEN
    CREATE TYPE "StatusCobrancaAdicional" AS ENUM ('A_AVALIAR', 'COBRAR', 'NAO_COBRAR');
  END IF;
END $$;

-- ───── 2–4. Colunas novas ─────
ALTER TABLE "checklist_tipo_itens" ADD COLUMN IF NOT EXISTS "unidade" TEXT;
ALTER TABLE "checklist_respostas" ADD COLUMN IF NOT EXISTS "valor" DECIMAL(12,3);
ALTER TABLE "checklist_respostas" ADD COLUMN IF NOT EXISTS "unidade" TEXT;
ALTER TABLE "checklist_respostas" ADD COLUMN IF NOT EXISTS "audio_url" TEXT;
ALTER TABLE "fotos_atendimento" ADD COLUMN IF NOT EXISTS "momento" "MomentoFoto";
ALTER TABLE "fotos_atendimento" ADD COLUMN IF NOT EXISTS "client_id" TEXT;

-- ───── 5. Tabelas novas ─────
CREATE TABLE IF NOT EXISTS "servicos_adicionais" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "ordem_servico_id" TEXT NOT NULL,
    "atividade_id" TEXT NOT NULL,
    "equipamento_id" TEXT,
    "descricao" TEXT NOT NULL,
    "status_cobranca" "StatusCobrancaAdicional" NOT NULL DEFAULT 'A_AVALIAR',
    "client_id" TEXT,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "servicos_adicionais_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "servicos_adicionais_fotos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "servico_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "client_id" TEXT,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "servicos_adicionais_fotos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sync_operacoes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "atividade_id" TEXT,
    "resultado" JSONB NOT NULL,
    "processado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_operacoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fotos_atendimento_client_id_key" ON "fotos_atendimento"("client_id");
CREATE UNIQUE INDEX IF NOT EXISTS "servicos_adicionais_client_id_key" ON "servicos_adicionais"("client_id");
CREATE INDEX IF NOT EXISTS "servicos_adicionais_ordem_servico_id_idx" ON "servicos_adicionais"("ordem_servico_id");
CREATE INDEX IF NOT EXISTS "servicos_adicionais_atividade_id_idx" ON "servicos_adicionais"("atividade_id");
CREATE INDEX IF NOT EXISTS "servicos_adicionais_equipamento_id_idx" ON "servicos_adicionais"("equipamento_id");
CREATE INDEX IF NOT EXISTS "servicos_adicionais_empresa_id_idx" ON "servicos_adicionais"("empresa_id");
CREATE UNIQUE INDEX IF NOT EXISTS "servicos_adicionais_fotos_client_id_key" ON "servicos_adicionais_fotos"("client_id");
CREATE INDEX IF NOT EXISTS "servicos_adicionais_fotos_servico_id_idx" ON "servicos_adicionais_fotos"("servico_id");
CREATE INDEX IF NOT EXISTS "servicos_adicionais_fotos_empresa_id_idx" ON "servicos_adicionais_fotos"("empresa_id");
CREATE INDEX IF NOT EXISTS "sync_operacoes_empresa_id_usuario_id_idx" ON "sync_operacoes"("empresa_id", "usuario_id");
CREATE INDEX IF NOT EXISTS "sync_operacoes_processado_em_idx" ON "sync_operacoes"("processado_em");

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('servicos_adicionais', 'servicos_adicionais_empresa_id_fkey', 'FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('servicos_adicionais', 'servicos_adicionais_ordem_servico_id_fkey', 'FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('servicos_adicionais', 'servicos_adicionais_atividade_id_fkey', 'FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('servicos_adicionais', 'servicos_adicionais_equipamento_id_fkey', 'FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('servicos_adicionais', 'servicos_adicionais_criado_por_id_fkey', 'FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('servicos_adicionais_fotos', 'servicos_adicionais_fotos_empresa_id_fkey', 'FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('servicos_adicionais_fotos', 'servicos_adicionais_fotos_servico_id_fkey', 'FOREIGN KEY ("servico_id") REFERENCES "servicos_adicionais"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('servicos_adicionais_fotos', 'servicos_adicionais_fotos_criado_por_id_fkey', 'FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('sync_operacoes', 'sync_operacoes_empresa_id_fkey', 'FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('sync_operacoes', 'sync_operacoes_usuario_id_fkey', 'FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE')
  ) AS t(tabela, nome, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tabela, fk.nome, fk.def);
    END IF;
  END LOOP;
END $$;

-- ───── 6. Checklists de fábrica: as medições viram itens de MEDIÇÃO (número + unidade) ─────
-- "_BASE" = a lista dos itens-base (a sugestão para tipo sem padrão, e para tipo personalizado que
-- usou "Usar checklist sugerido" na etapa 1).
CREATE TEMP TABLE "_itens_e1" ("chave" TEXT, "ordem" INTEGER, "texto" TEXT, "pedir_foto" BOOLEAN, "pedir_observacao" BOOLEAN) ON COMMIT DROP;
INSERT INTO "_itens_e1" VALUES
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
    ('CAMARA_FRIA', 16, 'Fixação e estrutura (suportes, base e parafusos)', false, false),
    ('_BASE', 1, 'Limpeza dos filtros de ar', true, false),
    ('_BASE', 2, 'Limpeza da serpentina evaporadora', true, false),
    ('_BASE', 3, 'Limpeza da serpentina condensadora', false, false),
    ('_BASE', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', false, false),
    ('_BASE', 5, 'Carga de gás refrigerante e verificação de vazamentos', false, false),
    ('_BASE', 6, 'Medição de pressão de sucção e de descarga', false, true),
    ('_BASE', 7, 'Medição de corrente do compressor e dos ventiladores', false, true),
    ('_BASE', 8, 'Medição de temperatura de insuflamento e retorno (delta T)', false, true),
    ('_BASE', 9, 'Conexões elétricas, contatora e disjuntor: aperto e estado', false, false),
    ('_BASE', 10, 'Estado dos motores, hélices e turbinas', false, false),
    ('_BASE', 11, 'Estado do isolamento térmico das tubulações', false, false),
    ('_BASE', 12, 'Ruídos e vibrações anormais', false, false),
    ('_BASE', 13, 'Teste de funcionamento (liga/desliga, termostato e controle)', false, false),
    ('_BASE', 14, 'Fixação e estrutura (suportes, base e parafusos)', false, false);

CREATE TEMP TABLE "_itens_e2" ("chave" TEXT, "ordem" INTEGER, "texto" TEXT, "tipo_resposta" TEXT, "unidade" TEXT, "pedir_foto" BOOLEAN, "pedir_observacao" BOOLEAN) ON COMMIT DROP;
INSERT INTO "_itens_e2" VALUES
    ('AR_CONDICIONADO_SPLIT', 1, 'Limpeza dos filtros de ar', 'OK_ATENCAO_NA', NULL, true, false),
    ('AR_CONDICIONADO_SPLIT', 2, 'Limpeza da serpentina evaporadora', 'OK_ATENCAO_NA', NULL, true, false),
    ('AR_CONDICIONADO_SPLIT', 3, 'Limpeza da serpentina condensadora', 'OK_ATENCAO_NA', NULL, false, false),
    ('AR_CONDICIONADO_SPLIT', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', 'OK_ATENCAO_NA', NULL, false, false),
    ('AR_CONDICIONADO_SPLIT', 5, 'Carga de gás refrigerante e verificação de vazamentos', 'OK_ATENCAO_NA', NULL, false, false),
    ('AR_CONDICIONADO_SPLIT', 6, 'Pressão de sucção', 'MEDICAO', 'psi', false, false),
    ('AR_CONDICIONADO_SPLIT', 7, 'Pressão de descarga', 'MEDICAO', 'psi', false, false),
    ('AR_CONDICIONADO_SPLIT', 8, 'Corrente do compressor', 'MEDICAO', 'A', false, false),
    ('AR_CONDICIONADO_SPLIT', 9, 'Corrente dos ventiladores', 'MEDICAO', 'A', false, false),
    ('AR_CONDICIONADO_SPLIT', 10, 'Temperatura de insuflamento', 'MEDICAO', '°C', false, false),
    ('AR_CONDICIONADO_SPLIT', 11, 'Temperatura de retorno', 'MEDICAO', '°C', false, false),
    ('AR_CONDICIONADO_SPLIT', 12, 'Conexões elétricas, contatora e disjuntor: aperto e estado', 'OK_ATENCAO_NA', NULL, false, false),
    ('AR_CONDICIONADO_SPLIT', 13, 'Estado dos motores, hélices e turbinas', 'OK_ATENCAO_NA', NULL, false, false),
    ('AR_CONDICIONADO_SPLIT', 14, 'Estado do isolamento térmico das tubulações', 'OK_ATENCAO_NA', NULL, false, false),
    ('AR_CONDICIONADO_SPLIT', 15, 'Ruídos e vibrações anormais', 'OK_ATENCAO_NA', NULL, false, false),
    ('AR_CONDICIONADO_SPLIT', 16, 'Teste de funcionamento (liga/desliga, termostato e controle)', 'OK_ATENCAO_NA', NULL, false, false),
    ('AR_CONDICIONADO_SPLIT', 17, 'Fixação e estrutura (suportes, base e parafusos)', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 1, 'Limpeza dos filtros de ar', 'OK_ATENCAO_NA', NULL, true, false),
    ('PISO_TETO', 2, 'Limpeza da serpentina evaporadora', 'OK_ATENCAO_NA', NULL, true, false),
    ('PISO_TETO', 3, 'Limpeza da serpentina condensadora', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 5, 'Bomba de drenagem e mangueira de dreno', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 6, 'Aletas e defletores de ar (movimento e estado)', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 7, 'Carga de gás refrigerante e verificação de vazamentos', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 8, 'Pressão de sucção', 'MEDICAO', 'psi', false, false),
    ('PISO_TETO', 9, 'Pressão de descarga', 'MEDICAO', 'psi', false, false),
    ('PISO_TETO', 10, 'Corrente do compressor', 'MEDICAO', 'A', false, false),
    ('PISO_TETO', 11, 'Corrente dos ventiladores', 'MEDICAO', 'A', false, false),
    ('PISO_TETO', 12, 'Temperatura de insuflamento', 'MEDICAO', '°C', false, false),
    ('PISO_TETO', 13, 'Temperatura de retorno', 'MEDICAO', '°C', false, false),
    ('PISO_TETO', 14, 'Conexões elétricas, contatora e disjuntor: aperto e estado', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 15, 'Estado dos motores, hélices e turbinas', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 16, 'Estado do isolamento térmico das tubulações', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 17, 'Ruídos e vibrações anormais', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 18, 'Teste de funcionamento (liga/desliga, termostato e controle)', 'OK_ATENCAO_NA', NULL, false, false),
    ('PISO_TETO', 19, 'Fixação e estrutura (suportes, base e parafusos)', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 1, 'Limpeza dos filtros de ar', 'OK_ATENCAO_NA', NULL, true, false),
    ('CASSETE', 2, 'Limpeza da serpentina evaporadora', 'OK_ATENCAO_NA', NULL, true, false),
    ('CASSETE', 3, 'Limpeza da serpentina condensadora', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 5, 'Bomba de drenagem e mangueira de dreno', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 6, 'Aletas e defletores de ar (movimento e estado)', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 7, 'Carga de gás refrigerante e verificação de vazamentos', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 8, 'Pressão de sucção', 'MEDICAO', 'psi', false, false),
    ('CASSETE', 9, 'Pressão de descarga', 'MEDICAO', 'psi', false, false),
    ('CASSETE', 10, 'Corrente do compressor', 'MEDICAO', 'A', false, false),
    ('CASSETE', 11, 'Corrente dos ventiladores', 'MEDICAO', 'A', false, false),
    ('CASSETE', 12, 'Temperatura de insuflamento', 'MEDICAO', '°C', false, false),
    ('CASSETE', 13, 'Temperatura de retorno', 'MEDICAO', '°C', false, false),
    ('CASSETE', 14, 'Conexões elétricas, contatora e disjuntor: aperto e estado', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 15, 'Estado dos motores, hélices e turbinas', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 16, 'Estado do isolamento térmico das tubulações', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 17, 'Ruídos e vibrações anormais', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 18, 'Teste de funcionamento (liga/desliga, termostato e controle)', 'OK_ATENCAO_NA', NULL, false, false),
    ('CASSETE', 19, 'Fixação e estrutura (suportes, base e parafusos)', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 1, 'Limpeza dos filtros de ar', 'OK_ATENCAO_NA', NULL, true, false),
    ('VRF', 2, 'Limpeza da serpentina evaporadora', 'OK_ATENCAO_NA', NULL, true, false),
    ('VRF', 3, 'Limpeza da serpentina condensadora', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 5, 'Carga de gás refrigerante e verificação de vazamentos', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 6, 'Pressão de sucção', 'MEDICAO', 'psi', false, false),
    ('VRF', 7, 'Pressão de descarga', 'MEDICAO', 'psi', false, false),
    ('VRF', 8, 'Pressões por circuito', 'OK_ATENCAO_NA', NULL, false, true),
    ('VRF', 9, 'Corrente do compressor', 'MEDICAO', 'A', false, false),
    ('VRF', 10, 'Corrente dos ventiladores', 'MEDICAO', 'A', false, false),
    ('VRF', 11, 'Temperatura de insuflamento', 'MEDICAO', '°C', false, false),
    ('VRF', 12, 'Temperatura de retorno', 'MEDICAO', '°C', false, false),
    ('VRF', 13, 'Conexões elétricas, contatora e disjuntor: aperto e estado', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 14, 'Estado dos motores, hélices e turbinas', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 15, 'Estado do isolamento térmico das tubulações', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 16, 'Ruídos e vibrações anormais', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 17, 'Teste de funcionamento (liga/desliga, termostato e controle)', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 18, 'Erros e alarmes no controlador central', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 19, 'Comunicação entre as unidades internas e externas', 'OK_ATENCAO_NA', NULL, false, false),
    ('VRF', 20, 'Fixação e estrutura (suportes, base e parafusos)', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 1, 'Limpeza da serpentina condensadora', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 2, 'Fluxo de água e bomba (vazão e fluxostato)', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 3, 'Pressostatos de alta e de baixa', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 4, 'Carga de gás refrigerante e verificação de vazamentos', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 5, 'Pressão de sucção', 'MEDICAO', 'psi', false, false),
    ('CHILLER', 6, 'Pressão de descarga', 'MEDICAO', 'psi', false, false),
    ('CHILLER', 7, 'Corrente do compressor', 'MEDICAO', 'A', false, false),
    ('CHILLER', 8, 'Corrente dos ventiladores', 'MEDICAO', 'A', false, false),
    ('CHILLER', 9, 'Temperatura de entrada da água', 'MEDICAO', '°C', false, false),
    ('CHILLER', 10, 'Temperatura de saída da água', 'MEDICAO', '°C', false, false),
    ('CHILLER', 11, 'Conexões elétricas, contatora e disjuntor: aperto e estado', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 12, 'Estado dos motores, hélices e turbinas', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 13, 'Estado do isolamento térmico das tubulações', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 14, 'Ruídos e vibrações anormais', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 15, 'Teste de funcionamento (liga/desliga, termostato e controle)', 'OK_ATENCAO_NA', NULL, false, false),
    ('CHILLER', 16, 'Fixação e estrutura (suportes, base e parafusos)', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 1, 'Limpeza dos filtros de ar', 'OK_ATENCAO_NA', NULL, true, false),
    ('SELF_CONTAINED', 2, 'Limpeza da serpentina evaporadora', 'OK_ATENCAO_NA', NULL, true, false),
    ('SELF_CONTAINED', 3, 'Limpeza da serpentina condensadora', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 5, 'Carga de gás refrigerante e verificação de vazamentos', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 6, 'Pressão de sucção', 'MEDICAO', 'psi', false, false),
    ('SELF_CONTAINED', 7, 'Pressão de descarga', 'MEDICAO', 'psi', false, false),
    ('SELF_CONTAINED', 8, 'Pressostatos de alta e de baixa', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 9, 'Corrente do compressor', 'MEDICAO', 'A', false, false),
    ('SELF_CONTAINED', 10, 'Corrente dos ventiladores', 'MEDICAO', 'A', false, false),
    ('SELF_CONTAINED', 11, 'Temperatura de insuflamento', 'MEDICAO', '°C', false, false),
    ('SELF_CONTAINED', 12, 'Temperatura de retorno', 'MEDICAO', '°C', false, false),
    ('SELF_CONTAINED', 13, 'Fluxo de água e bomba de condensação (quando a condensação é a água)', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 14, 'Conexões elétricas, contatora e disjuntor: aperto e estado', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 15, 'Estado dos motores, hélices e turbinas', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 16, 'Estado do isolamento térmico das tubulações', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 17, 'Ruídos e vibrações anormais', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 18, 'Teste de funcionamento (liga/desliga, termostato e controle)', 'OK_ATENCAO_NA', NULL, false, false),
    ('SELF_CONTAINED', 19, 'Fixação e estrutura (suportes, base e parafusos)', 'OK_ATENCAO_NA', NULL, false, false),
    ('FANCOIL', 1, 'Limpeza dos filtros de ar', 'OK_ATENCAO_NA', NULL, true, false),
    ('FANCOIL', 2, 'Limpeza da serpentina de água gelada', 'OK_ATENCAO_NA', NULL, true, false),
    ('FANCOIL', 3, 'Dreno e bandeja: limpeza e verificação de vazamento de água', 'OK_ATENCAO_NA', NULL, false, false),
    ('FANCOIL', 4, 'Válvula de controle de água gelada (2 ou 3 vias)', 'OK_ATENCAO_NA', NULL, false, false),
    ('FANCOIL', 5, 'Temperatura de entrada da água', 'MEDICAO', '°C', false, false),
    ('FANCOIL', 6, 'Temperatura de saída da água', 'MEDICAO', '°C', false, false),
    ('FANCOIL', 7, 'Temperatura de insuflamento', 'MEDICAO', '°C', false, false),
    ('FANCOIL', 8, 'Temperatura de retorno', 'MEDICAO', '°C', false, false),
    ('FANCOIL', 9, 'Corrente do motor do ventilador', 'MEDICAO', 'A', false, false),
    ('FANCOIL', 10, 'Correias e polias (tensão e desgaste)', 'OK_ATENCAO_NA', NULL, false, false),
    ('FANCOIL', 11, 'Conexões elétricas, contatora e disjuntor: aperto e estado', 'OK_ATENCAO_NA', NULL, false, false),
    ('FANCOIL', 12, 'Estado dos motores, hélices e turbinas', 'OK_ATENCAO_NA', NULL, false, false),
    ('FANCOIL', 13, 'Estado do isolamento térmico das tubulações', 'OK_ATENCAO_NA', NULL, false, false),
    ('FANCOIL', 14, 'Ruídos e vibrações anormais', 'OK_ATENCAO_NA', NULL, false, false),
    ('FANCOIL', 15, 'Teste de funcionamento (liga/desliga, termostato e controle)', 'OK_ATENCAO_NA', NULL, false, false),
    ('FANCOIL', 16, 'Fixação e estrutura (suportes, base e parafusos)', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 1, 'Limpeza da serpentina evaporadora', 'OK_ATENCAO_NA', NULL, true, false),
    ('CAMARA_FRIA', 2, 'Limpeza da serpentina condensadora', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 3, 'Dreno e bandeja: limpeza e verificação de vazamento de água', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 4, 'Carga de gás refrigerante e verificação de vazamentos', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 5, 'Pressão de sucção', 'MEDICAO', 'psi', false, false),
    ('CAMARA_FRIA', 6, 'Pressão de descarga', 'MEDICAO', 'psi', false, false),
    ('CAMARA_FRIA', 7, 'Corrente do compressor', 'MEDICAO', 'A', false, false),
    ('CAMARA_FRIA', 8, 'Corrente dos ventiladores', 'MEDICAO', 'A', false, false),
    ('CAMARA_FRIA', 9, 'Pressostatos de alta e de baixa', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 10, 'Temperatura medida na câmara', 'MEDICAO', '°C', false, false),
    ('CAMARA_FRIA', 11, 'Setpoint da câmara', 'MEDICAO', '°C', false, false),
    ('CAMARA_FRIA', 12, 'Degelo (resistências, ciclo e termostato de degelo)', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 13, 'Gaxetas e vedação da porta', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 14, 'Conexões elétricas, contatora e disjuntor: aperto e estado', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 15, 'Estado dos motores, hélices e turbinas', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 16, 'Estado do isolamento térmico das tubulações', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 17, 'Ruídos e vibrações anormais', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 18, 'Teste de funcionamento (liga/desliga, termostato e controle)', 'OK_ATENCAO_NA', NULL, false, false),
    ('CAMARA_FRIA', 19, 'Fixação e estrutura (suportes, base e parafusos)', 'OK_ATENCAO_NA', NULL, false, false),
    ('_BASE', 1, 'Limpeza dos filtros de ar', 'OK_ATENCAO_NA', NULL, true, false),
    ('_BASE', 2, 'Limpeza da serpentina evaporadora', 'OK_ATENCAO_NA', NULL, true, false),
    ('_BASE', 3, 'Limpeza da serpentina condensadora', 'OK_ATENCAO_NA', NULL, false, false),
    ('_BASE', 4, 'Dreno e bandeja: limpeza e verificação de vazamento de água', 'OK_ATENCAO_NA', NULL, false, false),
    ('_BASE', 5, 'Carga de gás refrigerante e verificação de vazamentos', 'OK_ATENCAO_NA', NULL, false, false),
    ('_BASE', 6, 'Pressão de sucção', 'MEDICAO', 'psi', false, false),
    ('_BASE', 7, 'Pressão de descarga', 'MEDICAO', 'psi', false, false),
    ('_BASE', 8, 'Corrente do compressor', 'MEDICAO', 'A', false, false),
    ('_BASE', 9, 'Corrente dos ventiladores', 'MEDICAO', 'A', false, false),
    ('_BASE', 10, 'Temperatura de insuflamento', 'MEDICAO', '°C', false, false),
    ('_BASE', 11, 'Temperatura de retorno', 'MEDICAO', '°C', false, false),
    ('_BASE', 12, 'Conexões elétricas, contatora e disjuntor: aperto e estado', 'OK_ATENCAO_NA', NULL, false, false),
    ('_BASE', 13, 'Estado dos motores, hélices e turbinas', 'OK_ATENCAO_NA', NULL, false, false),
    ('_BASE', 14, 'Estado do isolamento térmico das tubulações', 'OK_ATENCAO_NA', NULL, false, false),
    ('_BASE', 15, 'Ruídos e vibrações anormais', 'OK_ATENCAO_NA', NULL, false, false),
    ('_BASE', 16, 'Teste de funcionamento (liga/desliga, termostato e controle)', 'OK_ATENCAO_NA', NULL, false, false),
    ('_BASE', 17, 'Fixação e estrutura (suportes, base e parafusos)', 'OK_ATENCAO_NA', NULL, false, false);

-- Tipos cujo checklist ativo é EXATAMENTE o de fábrica da etapa 1 (texto, ordem e opções)
CREATE TEMP TABLE "_tipos_upgrade" ON COMMIT DROP AS
SELECT t."id", t."empresa_id", k."chave"
FROM "tipos_equipamento_custom" t
CROSS JOIN LATERAL (
  SELECT CASE WHEN EXISTS (SELECT 1 FROM "_itens_e1" e WHERE e."chave" = t."chave_enum") THEN t."chave_enum" ELSE '_BASE' END AS "chave"
) k
WHERE (
  SELECT string_agg(i."texto" || '|' || i."pedir_foto" || '|' || i."pedir_observacao" || '|' || i."tipo_resposta"::text, E'\n' ORDER BY i."ordem", i."criado_em")
  FROM "checklist_tipo_itens" i WHERE i."tipo_equipamento_id" = t."id" AND i."ativo"
) = (
  SELECT string_agg(e."texto" || '|' || e."pedir_foto" || '|' || e."pedir_observacao" || '|OK_ATENCAO_NA', E'\n' ORDER BY e."ordem")
  FROM "_itens_e1" e WHERE e."chave" = k."chave"
);

-- a) os itens que continuam (mesmo texto) só mudam de posição
UPDATE "checklist_tipo_itens" i SET "ordem" = e."ordem", "atualizado_em" = now()
FROM "_tipos_upgrade" u JOIN "_itens_e2" e ON e."chave" = u."chave"
WHERE i."tipo_equipamento_id" = u."id" AND i."ativo" AND i."texto" = e."texto" AND i."ordem" <> e."ordem";

-- b) as "Medição de …" antigas saem — INATIVADAS, nunca apagadas (as respostas já dadas ficam)
UPDATE "checklist_tipo_itens" i SET "ativo" = false, "atualizado_em" = now()
FROM "_tipos_upgrade" u
WHERE i."tipo_equipamento_id" = u."id" AND i."ativo"
  AND NOT EXISTS (SELECT 1 FROM "_itens_e2" e WHERE e."chave" = u."chave" AND e."texto" = i."texto");

-- c) os itens de medição entram, cada um na sua posição
INSERT INTO "checklist_tipo_itens" ("id", "empresa_id", "tipo_equipamento_id", "texto", "tipo_resposta", "unidade", "pedir_foto", "pedir_observacao", "ordem", "ativo", "criado_em", "atualizado_em")
SELECT gen_random_uuid()::text, u."empresa_id", u."id", e."texto", e."tipo_resposta"::"TipoRespostaChecklist", e."unidade", e."pedir_foto", e."pedir_observacao", e."ordem", true, now(), now()
FROM "_tipos_upgrade" u JOIN "_itens_e2" e ON e."chave" = u."chave"
WHERE NOT EXISTS (
  SELECT 1 FROM "checklist_tipo_itens" i WHERE i."tipo_equipamento_id" = u."id" AND i."ativo" AND i."texto" = e."texto"
);

COMMIT;
