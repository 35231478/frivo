-- Custo de Pessoal (gestão de folha — NÃO é folha oficial).
-- Aditivo e idempotente (pode rodar mais de uma vez). Não altera nenhuma tabela nem coluna existente:
-- só cria 2 enums e 3 tabelas novas. O salário/base continua na coluna que já existe (tecnicos.salario).
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "RegimeContratacao" AS ENUM ('CLT', 'PJ', 'DIARISTA', 'AUTONOMO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TipoAdicional" AS ENUM ('NENHUM', 'INSALUBRIDADE', 'PERICULOSIDADE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Modelos de encargos por regime (percentuais editáveis na tela)
CREATE TABLE IF NOT EXISTS "modelos_encargos" (
  "id"            TEXT NOT NULL,
  "empresa_id"    TEXT NOT NULL,
  "nome"          TEXT NOT NULL,
  "regime"        "RegimeContratacao" NOT NULL,
  "padrao"        BOOLEAN NOT NULL DEFAULT false,
  "itens"         JSONB NOT NULL DEFAULT '[]',
  "ativo"         BOOLEAN NOT NULL DEFAULT true,
  "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "modelos_encargos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "modelos_encargos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "modelos_encargos_empresa_id_nome_key" ON "modelos_encargos"("empresa_id", "nome");
CREATE INDEX IF NOT EXISTS "modelos_encargos_empresa_id_regime_idx" ON "modelos_encargos"("empresa_id", "regime");

-- Dados financeiros do colaborador (1:1 com tecnicos)
CREATE TABLE IF NOT EXISTS "colaborador_folha" (
  "id"                  TEXT NOT NULL,
  "empresa_id"          TEXT NOT NULL,
  "colaborador_id"      TEXT NOT NULL,
  "regime"              "RegimeContratacao" NOT NULL DEFAULT 'CLT',
  "valor_diaria"        DECIMAL(12,2),
  "dias_mes"            INTEGER,
  "horas_mes"           INTEGER NOT NULL DEFAULT 220,
  "adicional_tipo"      "TipoAdicional" NOT NULL DEFAULT 'NENHUM',
  "adicional_percent"   DECIMAL(6,2),
  "adicional_valor"     DECIMAL(12,2),
  "horas_extras_valor"  DECIMAL(12,2),
  "vale_transporte"     DECIMAL(12,2),
  "desconta_vt"         BOOLEAN NOT NULL DEFAULT true,
  "vale_alimentacao"    DECIMAL(12,2),
  "plano_saude"         DECIMAL(12,2),
  "outros_beneficios"   DECIMAL(12,2),
  "descontos"           DECIMAL(12,2),
  "descontos_descricao" TEXT,
  "modelo_encargos_id"  TEXT,
  "observacoes"         TEXT,
  "criado_em"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "colaborador_folha_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "colaborador_folha_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "colaborador_folha_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "tecnicos"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "colaborador_folha_modelo_encargos_id_fkey" FOREIGN KEY ("modelo_encargos_id") REFERENCES "modelos_encargos"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "colaborador_folha_colaborador_id_key" ON "colaborador_folha"("colaborador_id");
CREATE INDEX IF NOT EXISTS "colaborador_folha_empresa_id_idx" ON "colaborador_folha"("empresa_id");

-- Foto mensal do custo de cada colaborador (histórico; sem FK para o colaborador de propósito)
CREATE TABLE IF NOT EXISTS "folha_snapshots" (
  "id"             TEXT NOT NULL,
  "empresa_id"     TEXT NOT NULL,
  "competencia"    TEXT NOT NULL,
  "colaborador_id" TEXT NOT NULL,
  "nome"           TEXT NOT NULL,
  "funcao"         TEXT,
  "equipe"         TEXT,
  "regime"         "RegimeContratacao" NOT NULL,
  "base"           DECIMAL(12,2) NOT NULL,
  "adicionais"     DECIMAL(12,2) NOT NULL,
  "encargos"       DECIMAL(12,2) NOT NULL,
  "beneficios"     DECIMAL(12,2) NOT NULL,
  "descontos"      DECIMAL(12,2) NOT NULL,
  "custo_total"    DECIMAL(12,2) NOT NULL,
  "horas_mes"      INTEGER NOT NULL,
  "custo_hora"     DECIMAL(12,2) NOT NULL,
  "detalhe"        JSONB,
  "criado_por"     TEXT,
  "criado_em"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "folha_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "folha_snapshots_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "folha_snapshots_empresa_id_competencia_colaborador_id_key" ON "folha_snapshots"("empresa_id", "competencia", "colaborador_id");
CREATE INDEX IF NOT EXISTS "folha_snapshots_empresa_id_competencia_idx" ON "folha_snapshots"("empresa_id", "competencia");

COMMIT;

-- Conferência (deve retornar 3 linhas):
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('modelos_encargos', 'colaborador_folha', 'folha_snapshots');
--
-- Os modelos de encargos padrão (CLT, PJ, Diarista, Autônomo) são criados pelo próprio sistema
-- na primeira vez que alguém abre Financeiro → Custo de pessoal. Não precisa inserir nada aqui.
--
-- OPCIONAL (não precisa para o merge): liberar a nova permissão "Custo de pessoal" para os perfis
-- do tipo FINANCEIRO que já existem. Também dá para marcar na tela Configurações → Perfis de acesso.
-- Quem já está logado só recebe a permissão nova depois de sair e entrar de novo.
-- UPDATE perfis_acesso
--    SET permissoes = jsonb_set(permissoes::jsonb, '{financeiro,folha}', 'true'::jsonb, true)
--  WHERE tipo = 'FINANCEIRO' AND permissoes::jsonb ? 'financeiro';
