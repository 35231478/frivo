-- Estoque — Leva E4.2: consumo de material da OS (baixa definitiva) + Portão 1 da amarra (2ª das 3 partes da baixa:
-- E4.1 separação → E4.2 consumo → E4.3 devolução).
--
-- Depende da E4.1 ("os_materiais"."quantidade_separada"): sem ela, este script PARA no começo, sem mexer em nada.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. "os_materiais": quantidade_consumida (0), consumido_em, consumido_por_id (FK usuários, SET NULL) — o consumo
--      informado por material (estado_separacao passa a CONSUMIDO; a sobra separada − consumida fica "pendente de
--      devolução" até a E4.3);
--   2. "configuracoes"."os_exigir_prestacao_material" (false): a amarra "Exigir prestação de contas de material para
--      finalizar a OS" — opt-in por empresa.
-- A baixa em si vai para o razão (movimentacoes_estoque: SAIDA do consumido + estorno da RESERVA convertida, origem OS,
-- ref_id = id da OS) — nada novo no razão. OS, estoque e configuração antigos continuam idênticos. Sem seed.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-07_consumo_material.sql

BEGIN;

-- 0. Pré-requisito (E4.1)
DO $$
BEGIN
  IF to_regclass('"os_materiais"') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'os_materiais' AND column_name = 'quantidade_separada'
  ) THEN
    RAISE EXCEPTION 'Falta a leva E4.1: rode antes prisma/sql/2026-11-07_separacao_material.sql';
  END IF;
END $$;

-- 1. Consumo por material da OS
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "quantidade_consumida" DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "consumido_em" TIMESTAMP(3);
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "consumido_por_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_materiais_consumido_por_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "os_materiais" ADD CONSTRAINT "os_materiais_consumido_por_id_fkey"
      FOREIGN KEY ("consumido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. A amarra (opt-in, desligada por padrão)
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "os_exigir_prestacao_material" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
