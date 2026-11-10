-- Cliente — Informações fiscais: colunas novas para alimentar o tomador da NFS-e (inscrição
-- municipal) e, no futuro, o destinatário da NF de produto (indicador de IE).
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): só adiciona
-- colunas que ainda não existem. Todas NULAS, sem default: nada nos cadastros existentes muda, nada
-- é removido. A coluna "inscricao_estadual" já existe e é reaproveitada (não entra aqui).
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-10_cliente_informacoes_fiscais.sql

BEGIN;

ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "optante_simples" BOOLEAN;
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "indicador_inscricao_estadual" TEXT; -- CONTRIBUINTE | ISENTO | NAO_CONTRIBUINTE
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "inscricao_municipal" TEXT;
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "inscricao_suframa" TEXT;

COMMIT;
