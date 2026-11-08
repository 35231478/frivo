-- Estoque — Leva E4.3: devolução da sobra de material + Portões 2 e 3 (fecha a E4: separa → consome → devolve).
--
-- Depende da E4.2 ("os_materiais"."quantidade_consumida"): sem ela, este script PARA no começo, sem mexer em nada.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. "os_materiais": quantidade_devolvida (0), devolvido_em, devolvido_por_id (FK usuários, SET NULL) — a devolução
--      da sobra separada (ou do reservado de OS cancelada) por material; estado_separacao passa a DEVOLVIDO.
-- A devolução em si vai para o razão (movimentacoes_estoque: DEVOLUCAO, origem OS, ref_id = id da OS) — nada novo no
-- razão nem na configuração (a amarra "Exigir prestação de contas" é a da E4.2). OS e estoque antigos continuam idênticos.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-08_devolucao_material.sql

BEGIN;

-- 0. Pré-requisito (E4.2)
DO $$
BEGIN
  IF to_regclass('"os_materiais"') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'os_materiais' AND column_name = 'quantidade_consumida'
  ) THEN
    RAISE EXCEPTION 'Falta a leva E4.2: rode antes prisma/sql/2026-11-07_consumo_material.sql';
  END IF;
END $$;

-- 1. Devolução por material da OS
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "quantidade_devolvida" DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "devolvido_em" TIMESTAMP(3);
ALTER TABLE "os_materiais" ADD COLUMN IF NOT EXISTS "devolvido_por_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_materiais_devolvido_por_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "os_materiais" ADD CONSTRAINT "os_materiais_devolvido_por_id_fkey"
      FOREIGN KEY ("devolvido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
