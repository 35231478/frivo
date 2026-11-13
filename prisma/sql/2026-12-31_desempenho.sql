-- DESEMPENHO (manutenção) — PR 1: MEDIR e MOSTRAR. Escore de qualidade por colaborador e por mês.
--
-- O que entra (tudo ADITIVO; nada é removido, alterado nem preenchido):
--   1. "atividades_os"."concluida_em": quando a atividade foi concluída. Até aqui o sistema só
--      guardava o status; sem a data não dá para saber se a conclusão foi no prazo. Fica VAZIA nas
--      atividades já concluídas (sem medição — não vira zero); passa a ser gravada a cada conclusão.
--   2. "desempenho_config": ajustes gerais da empresa (dias do retorno, nota baixa, link do modo TV).
--   3. "desempenho_tipos_retorno": quais tipos de OS contam como corretiva para detectar retorno.
--   4. "desempenho_perfis": os perfis de desempenho (Preventiva, Corretiva, Instalação, Encarregado…).
--   5. "desempenho_regras": pesos, meta mínima, faixas e penalidades de cada perfil, POR VIGÊNCIA
--      ("vigente_desde" = "AAAA-MM"): mudança vale para o mês seguinte, a regra do mês não é alterada.
--   6. "desempenho_participantes": qual colaborador está em qual perfil (um perfil por colaborador).
--   7. "desempenho_penalidades": a lista "a revisar" (retorno, ressalva, nota baixa, reclamação).
--      Nada pesa no escore sozinho: só o que alguém marcou "CONTA", com motivo.
--   8. "desempenho_premiacoes": a premiação do mês (texto + imagem do brinde).
--
-- Nenhuma tabela existente perde ou muda coluna. As tabelas novas nascem vazias: o módulo só passa a
-- existir para a empresa quando a gestão abre a configuração do Desempenho.
--
-- IDEMPOTENTE: IF NOT EXISTS em coluna, tabelas e índices; cada chave estrangeira só é criada quando
-- ainda não existe. Pode rodar mais de uma vez. Sem enum (tipo, situação e competência são TEXTO).
-- Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-31_desempenho.sql

BEGIN;

-- 1. Data de conclusão da atividade (coluna nova, vazia nas atividades que já existem)
ALTER TABLE "atividades_os" ADD COLUMN IF NOT EXISTS "concluida_em" TIMESTAMP(3);

-- 2. Tabelas do Desempenho
CREATE TABLE IF NOT EXISTS "desempenho_config" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "retorno_dias" INTEGER NOT NULL DEFAULT 30,
    "nota_baixa_ate" INTEGER NOT NULL DEFAULT 2,
    "tv_token" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desempenho_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "desempenho_tipos_retorno" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo_os_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desempenho_tipos_retorno_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "desempenho_perfis" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'TECNICO',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desempenho_perfis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "desempenho_regras" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "perfil_id" TEXT NOT NULL,
    "vigente_desde" TEXT NOT NULL,
    "peso_prazo" INTEGER NOT NULL,
    "peso_relatorio" INTEGER NOT NULL,
    "peso_avaliacao" INTEGER NOT NULL,
    "exigir_foto_antes_depois" BOOLEAN NOT NULL DEFAULT true,
    "penalidade_retorno" INTEGER NOT NULL DEFAULT 0,
    "penalidade_reclamacao" INTEGER NOT NULL DEFAULT 0,
    "meta_minima" INTEGER NOT NULL,
    "faixas" JSONB NOT NULL,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desempenho_regras_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "desempenho_participantes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tecnico_id" TEXT NOT NULL,
    "perfil_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desempenho_participantes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "desempenho_penalidades" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tecnico_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ordem_servico_id" TEXT,
    "os_retorno_id" TEXT,
    "equipamento_id" TEXT,
    "data_fato" TIMESTAMP(3) NOT NULL,
    "competencia" TEXT NOT NULL,
    "descricao" TEXT,
    "situacao" TEXT NOT NULL DEFAULT 'A_REVISAR',
    "motivo" TEXT,
    "revisado_por_id" TEXT,
    "revisado_em" TIMESTAMP(3),
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desempenho_penalidades_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "desempenho_premiacoes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "imagem" TEXT,
    "perfil_id" TEXT,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desempenho_premiacoes_pkey" PRIMARY KEY ("id")
);

-- 3. Índices e unicidades
CREATE UNIQUE INDEX IF NOT EXISTS "desempenho_config_empresa_id_key" ON "desempenho_config"("empresa_id");
CREATE UNIQUE INDEX IF NOT EXISTS "desempenho_config_tv_token_key" ON "desempenho_config"("tv_token");
CREATE UNIQUE INDEX IF NOT EXISTS "desempenho_tipos_retorno_empresa_id_tipo_os_id_key" ON "desempenho_tipos_retorno"("empresa_id", "tipo_os_id");
CREATE UNIQUE INDEX IF NOT EXISTS "desempenho_perfis_empresa_id_nome_key" ON "desempenho_perfis"("empresa_id", "nome");
CREATE INDEX IF NOT EXISTS "desempenho_regras_empresa_id_idx" ON "desempenho_regras"("empresa_id");
CREATE UNIQUE INDEX IF NOT EXISTS "desempenho_regras_perfil_id_vigente_desde_key" ON "desempenho_regras"("perfil_id", "vigente_desde");
CREATE UNIQUE INDEX IF NOT EXISTS "desempenho_participantes_tecnico_id_key" ON "desempenho_participantes"("tecnico_id");
CREATE INDEX IF NOT EXISTS "desempenho_participantes_empresa_id_idx" ON "desempenho_participantes"("empresa_id");
CREATE INDEX IF NOT EXISTS "desempenho_participantes_perfil_id_idx" ON "desempenho_participantes"("perfil_id");
CREATE UNIQUE INDEX IF NOT EXISTS "desempenho_penalidades_chave_key" ON "desempenho_penalidades"("chave");
CREATE INDEX IF NOT EXISTS "desempenho_penalidades_empresa_id_competencia_situacao_idx" ON "desempenho_penalidades"("empresa_id", "competencia", "situacao");
CREATE INDEX IF NOT EXISTS "desempenho_penalidades_tecnico_id_competencia_idx" ON "desempenho_penalidades"("tecnico_id", "competencia");
CREATE INDEX IF NOT EXISTS "desempenho_penalidades_ordem_servico_id_idx" ON "desempenho_penalidades"("ordem_servico_id");
CREATE INDEX IF NOT EXISTS "desempenho_penalidades_os_retorno_id_idx" ON "desempenho_penalidades"("os_retorno_id");
CREATE INDEX IF NOT EXISTS "desempenho_premiacoes_empresa_id_competencia_idx" ON "desempenho_premiacoes"("empresa_id", "competencia");

-- 4. Chaves estrangeiras (cada uma só é criada se ainda não existir)
DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"desempenho_config"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_config_empresa_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_config" ADD CONSTRAINT "desempenho_config_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"desempenho_tipos_retorno"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_tipos_retorno_empresa_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_tipos_retorno" ADD CONSTRAINT "desempenho_tipos_retorno_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_tipos_retorno_tipo_os_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_tipos_retorno" ADD CONSTRAINT "desempenho_tipos_retorno_tipo_os_id_fkey"
      FOREIGN KEY ("tipo_os_id") REFERENCES "tipos_os"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"desempenho_perfis"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_perfis_empresa_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_perfis" ADD CONSTRAINT "desempenho_perfis_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"desempenho_regras"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_regras_empresa_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_regras" ADD CONSTRAINT "desempenho_regras_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_regras_perfil_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_regras" ADD CONSTRAINT "desempenho_regras_perfil_id_fkey"
      FOREIGN KEY ("perfil_id") REFERENCES "desempenho_perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"desempenho_participantes"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_participantes_empresa_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_participantes" ADD CONSTRAINT "desempenho_participantes_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_participantes_tecnico_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_participantes" ADD CONSTRAINT "desempenho_participantes_tecnico_id_fkey"
      FOREIGN KEY ("tecnico_id") REFERENCES "tecnicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_participantes_perfil_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_participantes" ADD CONSTRAINT "desempenho_participantes_perfil_id_fkey"
      FOREIGN KEY ("perfil_id") REFERENCES "desempenho_perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"desempenho_penalidades"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_penalidades_empresa_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_penalidades" ADD CONSTRAINT "desempenho_penalidades_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_penalidades_tecnico_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_penalidades" ADD CONSTRAINT "desempenho_penalidades_tecnico_id_fkey"
      FOREIGN KEY ("tecnico_id") REFERENCES "tecnicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_penalidades_ordem_servico_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_penalidades" ADD CONSTRAINT "desempenho_penalidades_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_penalidades_os_retorno_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_penalidades" ADD CONSTRAINT "desempenho_penalidades_os_retorno_id_fkey"
      FOREIGN KEY ("os_retorno_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_penalidades_equipamento_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_penalidades" ADD CONSTRAINT "desempenho_penalidades_equipamento_id_fkey"
      FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_penalidades_revisado_por_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_penalidades" ADD CONSTRAINT "desempenho_penalidades_revisado_por_id_fkey"
      FOREIGN KEY ("revisado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_penalidades_criado_por_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_penalidades" ADD CONSTRAINT "desempenho_penalidades_criado_por_id_fkey"
      FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"desempenho_premiacoes"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_premiacoes_empresa_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_premiacoes" ADD CONSTRAINT "desempenho_premiacoes_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_premiacoes_perfil_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_premiacoes" ADD CONSTRAINT "desempenho_premiacoes_perfil_id_fkey"
      FOREIGN KEY ("perfil_id") REFERENCES "desempenho_perfis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
