-- Contas a Receber — renegociar. ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado
-- e nenhum dado existente muda (as colunas novas nascem vazias).
-- Pré-requisito: 2026-11-20_contas_receber_perda_estorno.sql.
--
-- Uma ou mais cobranças em aberto do mesmo cliente viram UMA conta nova (a renegociação, já parcelada
-- ou à vista): o saldo de cada + juros + multa − desconto. As originais ficam RENEGOCIADO e apontam
-- para a nova (renegociada_em_id); o que já entrou nelas continua recebido. Juros e multa são receita
-- financeira; o desconto é desconto concedido (colunas próprias na conta nova: não inflam o faturamento).
-- Permissão: a mesma de Perdas (Financeiro › Perdas) — sem permissão nova, sem re-login.

-- Status novo. Fora de transação no psql; dentro de uma (prisma db execute) também funciona no
-- PostgreSQL 12+ — o valor só não pode ser USADO na mesma transação, e este arquivo não usa.
ALTER TYPE "StatusContaReceber" ADD VALUE IF NOT EXISTS 'RENEGOCIADO';

ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "renegociada_em_id" TEXT;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "renegociacao_juros" DECIMAL(12,2);
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "renegociacao_multa" DECIMAL(12,2);
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "renegociacao_desconto" DECIMAL(12,2);
CREATE INDEX IF NOT EXISTS "contas_receber_renegociada_em_id_idx" ON "contas_receber" ("renegociada_em_id");

DO $$
BEGIN
  -- A original aponta para a renegociação (conta da mesma tabela). Apagar a renegociação solta o vínculo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_renegociada_em_id_fkey' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_renegociada_em_id_fkey"
      FOREIGN KEY ("renegociada_em_id") REFERENCES "contas_receber" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- Juros, multa e desconto nunca negativos
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_renegociacao_valores_check' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_renegociacao_valores_check" CHECK (
      ("renegociacao_juros" IS NULL OR "renegociacao_juros" >= 0)
      AND ("renegociacao_multa" IS NULL OR "renegociacao_multa" >= 0)
      AND ("renegociacao_desconto" IS NULL OR "renegociacao_desconto" >= 0));
  END IF;
  -- Uma conta não se renegocia nela mesma
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_renegociada_em_outra_check' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_renegociada_em_outra_check" CHECK ("renegociada_em_id" IS NULL OR "renegociada_em_id" <> "id");
  END IF;
END $$;
