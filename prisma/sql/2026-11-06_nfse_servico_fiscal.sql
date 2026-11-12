-- NFS-e PR2 — dados fiscais do SERVIÇO (alimentam o objeto `servico` da emissão no PlugNotas).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado. SEM enum novo (a
-- tributação do ISS é texto com CHECK). Backfill: nenhum — serviços existentes ficam sem os dados
-- fiscais novos (iss_retido = false) e são preenchidos depois; só a emissão (PR3) os exige.
-- Reaproveitados (já existiam): codigo_lc116 (servico.codigo), codigo_municipal (servico.codigoTributacao),
-- aliquota_iss (iss.aliquota).

ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "nfse_tributacao" TEXT;
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "iss_retido" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "cnae" VARCHAR(7);
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "discriminacao_padrao" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servicos_nfse_tributacao_check' AND conrelid = '"servicos"'::regclass) THEN
    ALTER TABLE "servicos" ADD CONSTRAINT "servicos_nfse_tributacao_check" CHECK ("nfse_tributacao" IS NULL OR "nfse_tributacao" IN
      ('TRIBUTAVEL', 'ISENTO', 'IMUNE', 'NAO_INCIDENCIA', 'SUSPENSA_JUDICIAL', 'SUSPENSA_ADMINISTRATIVA'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servicos_cnae_check' AND conrelid = '"servicos"'::regclass) THEN
    ALTER TABLE "servicos" ADD CONSTRAINT "servicos_cnae_check" CHECK ("cnae" IS NULL OR "cnae" ~ '^[0-9]{7}$');
  END IF;
END $$;
