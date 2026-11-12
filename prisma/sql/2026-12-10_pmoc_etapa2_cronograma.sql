-- PMOC — Etapa 2: o cronograma que gera as OS de manutenção preventiva.
--
--   1. "pmoc_cronogramas" (tabela nova): um ITEM do cronograma de um plano — a quem se aplica (todos os
--      equipamentos do plano, um tipo de equipamento ou um equipamento), o tipo de OS, a data de
--      início, de quantos em quantos meses ("intervalo_meses": 1 = mensal, 3 = trimestral, 12 = anual)
--      e o dia de execução (1 a 28). "ativo" = false é item excluído que já gerou OS: fica para o
--      histórico e não gera mais.
--   2. "pmoc_execucoes" (tabela nova): uma linha por (item do cronograma, equipamento, período AAAA-MM),
--      ligada à OS gerada. A chave única em "cronograma_id" + "equipamento_id" + "periodo" é o que
--      impede OS duplicada ao reagendar. "ordem_servico_id" fica vazio se a OS for apagada (a execução
--      continua registrada e não é gerada de novo).
--
-- ADITIVO e IDEMPOTENTE (pode rodar mais de uma vez, sem erro e sem efeito repetido): DUAS tabelas
-- novas, com os índices e as chaves estrangeiras nos nomes que o Prisma gera. Nenhuma coluna é criada
-- em tabela existente — nem em "ordens_servico" (a OS é ligada ao plano pela tabela de execuções);
-- nada existente é removido nem alterado. Não cria nem altera enum (a frequência é um número de
-- meses): por isso é um arquivo só. Não usa `prisma migrate`.
--
-- Depende das tabelas da Etapa 1 ("pmocs"), já em produção.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-10_pmoc_etapa2_cronograma.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "pmoc_cronogramas" (
    "id" TEXT NOT NULL,
    "pmoc_id" TEXT NOT NULL,
    "tipo_equipamento_id" TEXT,
    "equipamento_id" TEXT,
    "tipo_os_id" TEXT NOT NULL,
    "data_inicio" DATE NOT NULL,
    "intervalo_meses" INTEGER NOT NULL DEFAULT 1,
    "dia_execucao" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pmoc_cronogramas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pmoc_execucoes" (
    "id" TEXT NOT NULL,
    "pmoc_id" TEXT NOT NULL,
    "cronograma_id" TEXT NOT NULL,
    "equipamento_id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "data_prevista" TIMESTAMP(3) NOT NULL,
    "ordem_servico_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pmoc_execucoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pmoc_cronogramas_pmoc_id_idx" ON "pmoc_cronogramas"("pmoc_id");
CREATE INDEX IF NOT EXISTS "pmoc_cronogramas_tipo_os_id_idx" ON "pmoc_cronogramas"("tipo_os_id");
CREATE INDEX IF NOT EXISTS "pmoc_cronogramas_tipo_equipamento_id_idx" ON "pmoc_cronogramas"("tipo_equipamento_id");
CREATE INDEX IF NOT EXISTS "pmoc_cronogramas_equipamento_id_idx" ON "pmoc_cronogramas"("equipamento_id");
CREATE INDEX IF NOT EXISTS "pmoc_execucoes_pmoc_id_idx" ON "pmoc_execucoes"("pmoc_id");
CREATE INDEX IF NOT EXISTS "pmoc_execucoes_equipamento_id_idx" ON "pmoc_execucoes"("equipamento_id");
CREATE INDEX IF NOT EXISTS "pmoc_execucoes_ordem_servico_id_idx" ON "pmoc_execucoes"("ordem_servico_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pmoc_execucoes_cronograma_id_equipamento_id_periodo_key" ON "pmoc_execucoes"("cronograma_id", "equipamento_id", "periodo");

-- Chaves estrangeiras (cada uma só é criada se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_cronogramas_pmoc_id_fkey' AND conrelid = to_regclass('"pmoc_cronogramas"')) THEN
    ALTER TABLE "pmoc_cronogramas" ADD CONSTRAINT "pmoc_cronogramas_pmoc_id_fkey"
      FOREIGN KEY ("pmoc_id") REFERENCES "pmocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_cronogramas_tipo_equipamento_id_fkey' AND conrelid = to_regclass('"pmoc_cronogramas"')) THEN
    ALTER TABLE "pmoc_cronogramas" ADD CONSTRAINT "pmoc_cronogramas_tipo_equipamento_id_fkey"
      FOREIGN KEY ("tipo_equipamento_id") REFERENCES "tipos_equipamento_custom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_cronogramas_equipamento_id_fkey' AND conrelid = to_regclass('"pmoc_cronogramas"')) THEN
    ALTER TABLE "pmoc_cronogramas" ADD CONSTRAINT "pmoc_cronogramas_equipamento_id_fkey"
      FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_cronogramas_tipo_os_id_fkey' AND conrelid = to_regclass('"pmoc_cronogramas"')) THEN
    ALTER TABLE "pmoc_cronogramas" ADD CONSTRAINT "pmoc_cronogramas_tipo_os_id_fkey"
      FOREIGN KEY ("tipo_os_id") REFERENCES "tipos_os"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_execucoes_pmoc_id_fkey' AND conrelid = to_regclass('"pmoc_execucoes"')) THEN
    ALTER TABLE "pmoc_execucoes" ADD CONSTRAINT "pmoc_execucoes_pmoc_id_fkey"
      FOREIGN KEY ("pmoc_id") REFERENCES "pmocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_execucoes_cronograma_id_fkey' AND conrelid = to_regclass('"pmoc_execucoes"')) THEN
    ALTER TABLE "pmoc_execucoes" ADD CONSTRAINT "pmoc_execucoes_cronograma_id_fkey"
      FOREIGN KEY ("cronograma_id") REFERENCES "pmoc_cronogramas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_execucoes_equipamento_id_fkey' AND conrelid = to_regclass('"pmoc_execucoes"')) THEN
    ALTER TABLE "pmoc_execucoes" ADD CONSTRAINT "pmoc_execucoes_equipamento_id_fkey"
      FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_execucoes_ordem_servico_id_fkey' AND conrelid = to_regclass('"pmoc_execucoes"')) THEN
    ALTER TABLE "pmoc_execucoes" ADD CONSTRAINT "pmoc_execucoes_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
