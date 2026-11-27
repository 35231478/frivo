-- NOTIFICAÇÕES PUSH (com o app fechado): o registro do que foi enviado e o estado de cada aparelho.
--
-- 🔵 PENDENTE — aplicar ANTES de subir o código desta leva (o Prisma passa a ler as colunas e a tabela nova).
--
-- O LEVANTAMENTO (o que já existia):
--   • "push_subscriptions": uma linha por aparelho inscrito (endpoint e chaves do navegador), ligada ao
--     usuário. Existia sem uso (não havia envio). Por garantia, este SQL também a cria se não existir.
--
-- O QUE ENTRA (ADITIVO; nada é removido nem alterado; nenhuma linha existente muda de valor):
--   1. "push_subscriptions": três colunas novas, todas opcionais ou com padrão:
--        empresa_id      — a empresa do usuário na inscrição (anulável; as inscrições antigas ficam sem)
--        ultimo_envio_em — quando este aparelho recebeu por último (anulável)
--        falhas          — falhas seguidas não definitivas (padrão 0)
--      e um índice por usuário.
--   2. Tabela "push_envios": uma linha por pessoa e evento — o que foi enviado, quando e para quantos
--      aparelhos. A chave única (usuario_id, chave) impede mandar o mesmo aviso duas vezes (o mesmo
--      evento repetido, ou o sino e o agendador conferindo a mesma atividade esquecida).
--
-- SEM AS CHAVES VAPID no ambiente, nada é enviado e as tabelas ficam paradas.
--
-- Pode rodar mais de uma vez.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-04_push_notificacoes.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"         TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "endpoint"   TEXT NOT NULL,
  "p256dh"     TEXT NOT NULL,
  "auth"       TEXT NOT NULL,
  "user_agent" TEXT,
  "criado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions" ("endpoint");

ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "empresa_id" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "ultimo_envio_em" TIMESTAMP(3);
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "falhas" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx" ON "push_subscriptions" ("user_id");

CREATE TABLE IF NOT EXISTS "push_envios" (
  "id"         TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "usuario_id" TEXT NOT NULL,
  "tipo"       TEXT NOT NULL,
  "chave"      TEXT NOT NULL,
  "titulo"     TEXT NOT NULL,
  "url"        TEXT,
  "aparelhos"  INTEGER NOT NULL DEFAULT 0,
  "criado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_envios_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_envios_usuario_id_chave_key" ON "push_envios" ("usuario_id", "chave");
CREATE INDEX IF NOT EXISTS "push_envios_empresa_id_criado_em_idx" ON "push_envios" ("empresa_id", "criado_em");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_user_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_envios_empresa_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "push_envios" ADD CONSTRAINT "push_envios_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_envios_usuario_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "push_envios" ADD CONSTRAINT "push_envios_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
