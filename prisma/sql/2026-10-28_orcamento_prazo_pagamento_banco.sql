-- Orçamento: prazo de execução e forma de pagamento; empresa: dados bancários (saem no orçamento).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Rodar ANTES do merge/deploy.
-- Tudo opcional (NULL): orçamentos e empresas existentes ficam como estão.

ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "prazo_execucao" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "forma_pagamento" TEXT;

ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "banco_nome" TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "banco_agencia" TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "banco_conta" TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "banco_tipo_conta" TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "banco_titular" TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "pix_chave" TEXT;
