-- CHAT-1.2: situação e presença do técnico na lista de conversas do escritório.
--
--   1. "usuarios"."ultimo_contato_em" (coluna nova, opcional): o último contato do APP do técnico com o servidor
--      (sincronização, tempo real do chat, localização). O sistema grava no máximo 1 vez por minuto por usuário; o
--      escritório vê o ponto verde (app ativo nos últimos 2 min), o "visto por último" e o "Sem sinal há N min".
--      Nula = o app ainda não falou com o servidor depois desta mudança (nada aparece).
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): uma coluna nova, sem valor
-- padrão e sem índice (a leitura é pela chave). Nada existente é removido nem alterado.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-03-01_chat_1_2_presenca.sql

BEGIN;

ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "ultimo_contato_em" TIMESTAMP(3);

COMMIT;
