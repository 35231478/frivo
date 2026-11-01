-- Contrato recorrente — PR3-A: periodicidade de cobrança + rotina de faturamento automático.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado.
--
-- ATENÇÃO (decisão do dono, opção b): até aqui a periodicidade do contrato era IGNORADA (tudo cobrava
-- por mês). Na PRIMEIRA rodada deste SQL, os contratos existentes ficam MENSAL (como já cobravam);
-- a periodicidade não-mensal passa a valer só para o que for cadastrado/editado depois. Isso roda UMA
-- vez só: a 2ª rodada (com as colunas novas já criadas) não mexe mais na periodicidade de ninguém.
-- Para ver antes quais mudam:  SELECT numero, periodicidade FROM contratos WHERE periodicidade <> 'MENSAL';

-- 1) Uma vez só: existentes → MENSAL (marca de "já rodou" = a coluna faturamento_automatico existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'contratos' AND column_name = 'faturamento_automatico'
  ) THEN
    UPDATE "contratos" SET "periodicidade" = 'MENSAL' WHERE "periodicidade" <> 'MENSAL';
  END IF;
END $$;

-- 2) Tipos novos
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'ReferenciaNfse' AND n.nspname = current_schema()) THEN
    CREATE TYPE "ReferenciaNfse" AS ENUM ('CORRENTE', 'ANTERIOR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'EtapaFaturamento' AND n.nspname = current_schema()) THEN
    CREATE TYPE "EtapaFaturamento" AS ENUM ('MEDICAO', 'APROVACAO', 'NFSE', 'BOLETO', 'CONCLUIDA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'SituacaoFaturamento' AND n.nspname = current_schema()) THEN
    CREATE TYPE "SituacaoFaturamento" AS ENUM ('PENDENTE', 'AGUARDANDO', 'PENDENCIA', 'FALHA', 'CONCLUIDA', 'CANCELADA');
  END IF;
END $$;

-- 3) Chaves do contrato (todas desligadas: nada muda até alguém ligar)
ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "faturamento_automatico" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "aprovacao_automatica" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "emitir_nfse_auto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "emitir_boleto_auto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "nfse_referencia" "ReferenciaNfse" NOT NULL DEFAULT 'CORRENTE';

-- 4) Execuções da rotina: uma por contrato × competência
CREATE TABLE IF NOT EXISTS "faturamento_contrato_execucoes" (
  "id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "contrato_id" TEXT NOT NULL,
  "ref_ano" INTEGER NOT NULL,
  "ref_mes" INTEGER NOT NULL,
  "medicao_id" TEXT,
  "etapa" "EtapaFaturamento" NOT NULL DEFAULT 'MEDICAO',
  "situacao" "SituacaoFaturamento" NOT NULL DEFAULT 'PENDENTE',
  "erro" TEXT,
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "proxima_tentativa" TIMESTAMP(3),
  "processando_ate" TIMESTAMP(3),
  "concluida_em" TIMESTAMP(3),
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "faturamento_contrato_execucoes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "faturamento_contrato_execucoes_ref_mes_check" CHECK ("ref_mes" BETWEEN 1 AND 12),
  CONSTRAINT "faturamento_contrato_execucoes_tentativas_check" CHECK ("tentativas" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "faturamento_contrato_execucoes_contrato_id_ref_ano_ref_mes_key"
  ON "faturamento_contrato_execucoes" ("contrato_id", "ref_ano", "ref_mes");
CREATE INDEX IF NOT EXISTS "faturamento_contrato_execucoes_empresa_id_situacao_idx"
  ON "faturamento_contrato_execucoes" ("empresa_id", "situacao");
CREATE INDEX IF NOT EXISTS "faturamento_contrato_execucoes_medicao_id_idx"
  ON "faturamento_contrato_execucoes" ("medicao_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'faturamento_contrato_execucoes_empresa_id_fkey' AND conrelid = '"faturamento_contrato_execucoes"'::regclass) THEN
    ALTER TABLE "faturamento_contrato_execucoes" ADD CONSTRAINT "faturamento_contrato_execucoes_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'faturamento_contrato_execucoes_contrato_id_fkey' AND conrelid = '"faturamento_contrato_execucoes"'::regclass) THEN
    ALTER TABLE "faturamento_contrato_execucoes" ADD CONSTRAINT "faturamento_contrato_execucoes_contrato_id_fkey"
      FOREIGN KEY ("contrato_id") REFERENCES "contratos" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'faturamento_contrato_execucoes_medicao_id_fkey' AND conrelid = '"faturamento_contrato_execucoes"'::regclass) THEN
    ALTER TABLE "faturamento_contrato_execucoes" ADD CONSTRAINT "faturamento_contrato_execucoes_medicao_id_fkey"
      FOREIGN KEY ("medicao_id") REFERENCES "medicoes" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
