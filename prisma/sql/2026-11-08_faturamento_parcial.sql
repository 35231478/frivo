-- Faturamento — P5: faturamento parcial do orçamento/OS ("Faturar parcial": parte agora, o resto fica a faturar).
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. "medicoes": fatura_parcial (false) — a fatura cobre só parte da origem; percentual_faturado (NULL) — a fatia
--      do total da origem que esta fatura representa.
-- O faturado acumulado da origem é a SOMA do valor líquido das faturas avulsas vivas ligadas a ela pelos itens
-- (medicao_itens.orcamento_id / ordem_servico_id): nada novo a guardar além destes dois campos. Faturas existentes
-- nascem com fatura_parcial = false e percentual NULL — orçamento já faturado inteiro (1 fatura) continua idêntico.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-08_faturamento_parcial.sql

BEGIN;

ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "fatura_parcial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "percentual_faturado" DECIMAL(6,2);

COMMIT;
