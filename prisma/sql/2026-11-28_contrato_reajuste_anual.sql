-- Contrato recorrente — PR4: reajuste anual SUGERIDO e CONFIRMADO (D8). O horizonte rolante não muda o banco.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado, nenhum valor muda.
--
-- reajustes_contrato vira o histórico das DECISÕES de cada aniversário: aplicado (quem, quando, de quanto para
-- quanto) ou dispensado (com motivo). Uma decisão por contrato × ano de aniversário (índice único): dois cliques
-- ou duas abas não aplicam o reajuste duas vezes. As linhas antigas (sem ano) ficam como estão.
-- contratos.reajuste_adiado_ate: "Adiar" esconde a sugestão até esta data.

-- 1) Tipo novo
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'SituacaoReajuste' AND n.nspname = current_schema()) THEN
    CREATE TYPE "SituacaoReajuste" AS ENUM ('APLICADO', 'DISPENSADO');
  END IF;
END $$;

-- 2) Colunas novas
ALTER TABLE "reajustes_contrato" ADD COLUMN IF NOT EXISTS "ano_referencia" INTEGER;
ALTER TABLE "reajustes_contrato" ADD COLUMN IF NOT EXISTS "mes_referencia" INTEGER;
ALTER TABLE "reajustes_contrato" ADD COLUMN IF NOT EXISTS "situacao" "SituacaoReajuste" NOT NULL DEFAULT 'APLICADO';
ALTER TABLE "reajustes_contrato" ADD COLUMN IF NOT EXISTS "usuario_id" TEXT;
ALTER TABLE "reajustes_contrato" ADD COLUMN IF NOT EXISTS "motivo" TEXT;
ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "reajuste_adiado_ate" DATE;

-- 3) Regras no banco
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reajustes_contrato_mes_referencia_check' AND conrelid = 'reajustes_contrato'::regclass) THEN
    ALTER TABLE "reajustes_contrato" ADD CONSTRAINT "reajustes_contrato_mes_referencia_check" CHECK ("mes_referencia" BETWEEN 1 AND 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reajustes_contrato_usuario_id_fkey' AND conrelid = 'reajustes_contrato'::regclass) THEN
    ALTER TABLE "reajustes_contrato" ADD CONSTRAINT "reajustes_contrato_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Uma decisão por contrato × ano de aniversário (as linhas antigas, sem ano, não entram: NULL não repete)
CREATE UNIQUE INDEX IF NOT EXISTS "reajustes_contrato_contrato_id_ano_referencia_key" ON "reajustes_contrato" ("contrato_id", "ano_referencia");
CREATE INDEX IF NOT EXISTS "reajustes_contrato_usuario_id_idx" ON "reajustes_contrato" ("usuario_id");
