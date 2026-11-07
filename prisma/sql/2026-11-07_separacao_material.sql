-- Estoque — Leva E4.1: separação + reserva de material para a OS (1ª das 3 partes da baixa: E4.1 separação →
-- E4.2 consumo → E4.3 devolução).
--
-- Depende da E3.3b (tabela "os_materiais") e da E1 (tipo RESERVA no razão): sem elas, este script PARA no começo,
-- sem mexer em nada.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. tipo "EstadoSeparacaoMaterial" (SEPARADO / CONSUMIDO / DEVOLVIDO);
--   2. "os_materiais": quantidade_separada (0 = nada separado; é o que está reservado no razão para a OS),
--      estado_separacao (NULL = nada separado; SEPARADO = prestação de contas pendente; CONSUMIDO e DEVOLVIDO
--      são das levas E4.2/E4.3), separado_em, separado_por_id (FK usuários, SET NULL) + índice (OS, estado).
-- A separação em si vai para o razão (movimentacoes_estoque: tipo RESERVA, origem OS, ref_id = id da OS) — nada
-- novo no razão. OS antiga e estoque antigo continuam idênticos (padrões 0/NULL). Sem seed.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-07_separacao_material.sql

BEGIN;

-- 0. Pré-requisitos (E3.3b e E1)
DO $$
BEGIN
  IF to_regclass('"os_materiais"') IS NULL THEN
    RAISE EXCEPTION 'Falta a leva E3.3b: rode antes prisma/sql/2026-11-07_materiais_os.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'TipoMovimentacaoEstoque' AND n.nspname = current_schema() AND e.enumlabel = 'RESERVA'
  ) THEN
    RAISE EXCEPTION 'Falta a leva E1 (complemento): rode antes prisma/sql/2026-11-06_estoque_e1_complemento.sql';
  END IF;
END $$;

-- 1. Tipo
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'EstadoSeparacaoMaterial' AND n.nspname = current_schema()) THEN
    CREATE TYPE "EstadoSeparacaoMaterial" AS ENUM ('SEPARADO', 'CONSUMIDO', 'DEVOLVIDO');
  END IF;
END $$;

-- 2. Separação por material da OS
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "quantidade_separada" DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "estado_separacao" "EstadoSeparacaoMaterial";
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "separado_em" TIMESTAMP(3);
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "separado_por_id" TEXT;

CREATE INDEX IF NOT EXISTS "os_materiais_ordem_servico_id_estado_separacao_idx" ON "os_materiais"("ordem_servico_id", "estado_separacao");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_materiais_separado_por_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "os_materiais" ADD CONSTRAINT "os_materiais_separado_por_id_fkey"
      FOREIGN KEY ("separado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
