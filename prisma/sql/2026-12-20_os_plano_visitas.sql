-- OS EM CAMPANHA / MÚLTIPLAS VISITAS: a manutenção grande dividida em visitas diárias.
--
-- O que entra (tudo ADITIVO; nada é removido nem alterado):
--   1. "os_planos_visitas": o plano de visitas de uma OS (um por OS): quantos equipamentos por dia e
--      se pula sábado e domingo.
--   2. "atividades_os"."plano_visitas_id": marca a atividade como VISITA do plano. Vazio = atividade
--      comum (todas as que já existem continuam vazias: nada muda para elas).
--
-- A visita É uma atividade da OS, com o seu lote em "atividade_equipamentos" — as tabelas que já
-- existem. Não cria enum, por isso é um arquivo só.
--
-- IDEMPOTENTE: IF NOT EXISTS em tabela, coluna e índices; as chaves estrangeiras só são criadas
-- quando ainda não existem. Pode rodar mais de uma vez. Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-20_os_plano_visitas.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "os_planos_visitas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "ordem_servico_id" TEXT NOT NULL,
    "por_dia" INTEGER NOT NULL,
    "pular_fim_semana" BOOLEAN NOT NULL DEFAULT true,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "os_planos_visitas_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "atividades_os" ADD COLUMN IF NOT EXISTS "plano_visitas_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "os_planos_visitas_ordem_servico_id_key" ON "os_planos_visitas"("ordem_servico_id");
CREATE INDEX IF NOT EXISTS "os_planos_visitas_empresa_id_idx" ON "os_planos_visitas"("empresa_id");
CREATE INDEX IF NOT EXISTS "atividades_os_plano_visitas_id_idx" ON "atividades_os"("plano_visitas_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_planos_visitas_ordem_servico_id_fkey' AND conrelid = to_regclass('"os_planos_visitas"')) THEN
    ALTER TABLE "os_planos_visitas" ADD CONSTRAINT "os_planos_visitas_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atividades_os_plano_visitas_id_fkey' AND conrelid = to_regclass('"atividades_os"')) THEN
    ALTER TABLE "atividades_os" ADD CONSTRAINT "atividades_os_plano_visitas_id_fkey"
      FOREIGN KEY ("plano_visitas_id") REFERENCES "os_planos_visitas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
