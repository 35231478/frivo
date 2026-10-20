-- Autenticação — Fase A: limite de tentativas (anti força bruta) no login e no "esqueci a senha".
--
-- Cria só a tabela "tentativas_acesso" (uma linha por tentativa que conta para o limite). Ela não tem
-- empresa (o login acontece antes de saber a empresa) e a coluna "chave" guarda apenas o HASH do
-- e-mail / IP / usuário — nunca o texto. O sistema apaga sozinho as linhas com mais de 1 dia.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido). Nada existente
-- muda. Se o deploy sair antes deste SQL, o login continua funcionando — só sem o limite.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-20_auth_tentativas.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "tentativas_acesso" (
  "id" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "chave" TEXT NOT NULL,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tentativas_acesso_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tentativas_acesso_tipo_chave_criado_em_idx" ON "tentativas_acesso"("tipo", "chave", "criado_em");
CREATE INDEX IF NOT EXISTS "tentativas_acesso_criado_em_idx" ON "tentativas_acesso"("criado_em");

COMMIT;
