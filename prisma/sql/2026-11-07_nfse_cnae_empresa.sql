-- NFS-e — CNAE principal da EMPRESA (o serviço sem CNAE próprio herda este na nota).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado. Sem enum. Sem backfill
-- (a empresa informa em Configurações › Dados da empresa). Nos serviços nada muda: servicos.cnae
-- vazio passa a significar "usar o CNAE principal da empresa"; quem já tem CNAE próprio continua com ele.

ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "cnae_principal" VARCHAR(7);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empresas_cnae_principal_check' AND conrelid = '"empresas"'::regclass) THEN
    ALTER TABLE "empresas" ADD CONSTRAINT "empresas_cnae_principal_check" CHECK ("cnae_principal" IS NULL OR "cnae_principal" ~ '^[0-9]{7}$');
  END IF;
END $$;
