-- Leva 5 (Dinheiro — contrato): vínculo contrato × competência nas previsões (C6),
-- escolha consolidado × separado dos adicionais (D3).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Rodar ANTES do merge/deploy.

-- 1) Enum da forma de faturamento dos adicionais do contrato
DO $$ BEGIN
  CREATE TYPE "FaturamentoAdicionais" AS ENUM ('SEPARADO', 'CONSOLIDADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Contrato: como cobrar os serviços avulsos (padrão: faturas separadas — D3)
ALTER TABLE "contratos"
  ADD COLUMN IF NOT EXISTS "faturamento_adicionais" "FaturamentoAdicionais" NOT NULL DEFAULT 'SEPARADO';

-- 3) Conta a receber: vínculo com o contrato e a competência (C6)
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "contrato_id" TEXT;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "ref_mes" INTEGER;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "ref_ano" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_contrato_id_fkey') THEN
    ALTER TABLE "contas_receber"
      ADD CONSTRAINT "contas_receber_contrato_id_fkey"
      FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "contas_receber_contrato_id_idx" ON "contas_receber"("contrato_id");

-- 4) BACKFILL: liga as previsões antigas (numero = "<numero do contrato>/AAAAMM") ao contrato
--    e grava a competência. Só mexe em linhas ainda sem vínculo.
UPDATE "contas_receber" cr
SET "contrato_id" = ct."id",
    "ref_ano" = substring(cr."numero" from '/(\d{4})\d{2}$')::int,
    "ref_mes" = substring(cr."numero" from '/\d{4}(\d{2})$')::int
FROM "contratos" ct
WHERE cr."contrato_id" IS NULL
  AND cr."empresa_id" = ct."empresa_id"
  AND cr."cliente_id" = ct."cliente_id"
  AND cr."numero" ~ '/\d{6}$'
  AND cr."numero" = ct."numero" || '/' || substring(cr."numero" from '/(\d{6})$')
  -- 2ª rodada: não religa uma conta cuja competência já tem dona (idempotência com o unique)
  AND NOT EXISTS (
    SELECT 1 FROM "contas_receber" x
    WHERE x."contrato_id" = ct."id"
      AND x."ref_ano" = substring(cr."numero" from '/(\d{4})\d{2}$')::int
      AND x."ref_mes" = substring(cr."numero" from '/\d{4}(\d{2})$')::int
  );

-- 5) Antes do índice único: se o backfill encontrou DUPLICADAS do mesmo contrato+competência
--    (corrida antiga), mantém a mais antiga ligada e solta o vínculo das demais (a conta fica
--    intacta, só sem o vínculo — nada é apagado).
WITH ranqueadas AS (
  SELECT id, row_number() OVER (PARTITION BY "contrato_id", "ref_ano", "ref_mes" ORDER BY "criado_em" ASC) AS rn
  FROM "contas_receber"
  WHERE "contrato_id" IS NOT NULL AND "ref_ano" IS NOT NULL AND "ref_mes" IS NOT NULL
)
UPDATE "contas_receber" cr
SET "contrato_id" = NULL, "ref_mes" = NULL, "ref_ano" = NULL
FROM ranqueadas r
WHERE cr.id = r.id AND r.rn > 1;

-- 6) Uma previsão por contrato × competência (NULLs não contam no unique do Postgres)
CREATE UNIQUE INDEX IF NOT EXISTS "contas_receber_contrato_id_ref_ano_ref_mes_key"
  ON "contas_receber"("contrato_id", "ref_ano", "ref_mes");
