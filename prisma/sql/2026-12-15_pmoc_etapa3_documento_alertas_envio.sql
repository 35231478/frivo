-- PMOC — Etapa 3: documento em PDF, alertas de vencimento e envio ao cliente.
--
-- O que entra (tudo ADITIVO; nada é removido nem alterado):
--   1. "pmocs"."token_publico": o segredo do link público do documento (/relatorio/pmoc/<token>).
--      Nasce vazio; o sistema grava o token no 1º envio do plano ao cliente.
--   2. "pmoc_historico": a linha do tempo do plano (envios ao cliente, avisos de vencimento, ART).
--   3. "pmoc_avisos": o aviso de vencimento já registrado — um por (plano, tipo, data de expiração).
--      A chave única é o que impede o mesmo aviso de ser registrado duas vezes.
--   4. "pmoc_configuracoes": o padrão da empresa (dias de antecedência do aviso e o texto técnico
--      dos planos novos). Uma linha por empresa, criada só quando alguém salva a configuração.
--
-- Não cria enum (o tipo do aviso é texto: 'VENCENDO' ou 'EXPIRADO'), por isso é um arquivo só.
--
-- IDEMPOTENTE: IF NOT EXISTS em colunas, tabelas e índices; as chaves estrangeiras só são criadas
-- quando ainda não existem. Pode rodar mais de uma vez. Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-15_pmoc_etapa3_documento_alertas_envio.sql

BEGIN;

ALTER TABLE "pmocs" ADD COLUMN IF NOT EXISTS "token_publico" TEXT;

CREATE TABLE IF NOT EXISTS "pmoc_historico" (
    "id" TEXT NOT NULL,
    "pmoc_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "acao" TEXT NOT NULL,
    "detalhes" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pmoc_historico_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pmoc_avisos" (
    "id" TEXT NOT NULL,
    "pmoc_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "data_expiracao" DATE NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visto_em" TIMESTAMP(3),
    "visto_por_id" TEXT,
    CONSTRAINT "pmoc_avisos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pmoc_configuracoes" (
    "empresa_id" TEXT NOT NULL,
    "dias_aviso" INTEGER NOT NULL DEFAULT 30,
    "texto_padrao" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pmoc_configuracoes_pkey" PRIMARY KEY ("empresa_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pmocs_token_publico_key" ON "pmocs"("token_publico");
CREATE INDEX IF NOT EXISTS "pmoc_historico_pmoc_id_criado_em_idx" ON "pmoc_historico"("pmoc_id", "criado_em");
CREATE UNIQUE INDEX IF NOT EXISTS "pmoc_avisos_pmoc_id_tipo_data_expiracao_key" ON "pmoc_avisos"("pmoc_id", "tipo", "data_expiracao");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_historico_pmoc_id_fkey' AND conrelid = to_regclass('"pmoc_historico"')) THEN
    ALTER TABLE "pmoc_historico" ADD CONSTRAINT "pmoc_historico_pmoc_id_fkey"
      FOREIGN KEY ("pmoc_id") REFERENCES "pmocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_historico_usuario_id_fkey' AND conrelid = to_regclass('"pmoc_historico"')) THEN
    ALTER TABLE "pmoc_historico" ADD CONSTRAINT "pmoc_historico_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_avisos_pmoc_id_fkey' AND conrelid = to_regclass('"pmoc_avisos"')) THEN
    ALTER TABLE "pmoc_avisos" ADD CONSTRAINT "pmoc_avisos_pmoc_id_fkey"
      FOREIGN KEY ("pmoc_id") REFERENCES "pmocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_avisos_visto_por_id_fkey' AND conrelid = to_regclass('"pmoc_avisos"')) THEN
    ALTER TABLE "pmoc_avisos" ADD CONSTRAINT "pmoc_avisos_visto_por_id_fkey"
      FOREIGN KEY ("visto_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_configuracoes_empresa_id_fkey' AND conrelid = to_regclass('"pmoc_configuracoes"')) THEN
    ALTER TABLE "pmoc_configuracoes" ADD CONSTRAINT "pmoc_configuracoes_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
