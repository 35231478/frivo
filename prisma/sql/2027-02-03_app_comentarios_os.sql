-- App do técnico: COMENTÁRIOS NA OS entre o técnico e o escritório (leva app-campo 2, PR A).
--
--   1. "os_comentarios" (tabela nova): a conversa INTERNA da OS (o cliente nunca vê). O técnico escreve pelo app, com ou
--      sem sinal; "client_id" (gerado no aparelho) faz o comentário reenviado não duplicar (chave única empresa +
--      client_id). Nada se edita nem se apaga.
--   2. "os_comentarios_lidos" (tabela nova): até quando cada pessoa do escritório leu os comentários de cada OS (o sino
--      conta os do campo depois disso).
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): DUAS tabelas novas, com os
-- índices e as chaves estrangeiras nos nomes que o Prisma gera. Nada existente é removido nem alterado.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-03_app_comentarios_os.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "os_comentarios" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "ordem_servico_id" TEXT NOT NULL,
    "atividade_id" TEXT,
    "usuario_id" TEXT NOT NULL,
    "autor_nome" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "client_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "os_comentarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "os_comentarios_lidos" (
    "usuario_id" TEXT NOT NULL,
    "ordem_servico_id" TEXT NOT NULL,
    "lido_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "os_comentarios_lidos_pkey" PRIMARY KEY ("usuario_id","ordem_servico_id")
);

CREATE INDEX IF NOT EXISTS "os_comentarios_ordem_servico_id_criado_em_idx" ON "os_comentarios"("ordem_servico_id", "criado_em");
CREATE INDEX IF NOT EXISTS "os_comentarios_empresa_id_origem_criado_em_idx" ON "os_comentarios"("empresa_id", "origem", "criado_em");
CREATE UNIQUE INDEX IF NOT EXISTS "os_comentarios_empresa_id_client_id_key" ON "os_comentarios"("empresa_id", "client_id");
CREATE INDEX IF NOT EXISTS "os_comentarios_lidos_ordem_servico_id_idx" ON "os_comentarios_lidos"("ordem_servico_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'os_comentarios_ordem_servico_id_fkey' AND conrelid = to_regclass('"os_comentarios"')
  ) THEN
    ALTER TABLE "os_comentarios" ADD CONSTRAINT "os_comentarios_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'os_comentarios_atividade_id_fkey' AND conrelid = to_regclass('"os_comentarios"')
  ) THEN
    ALTER TABLE "os_comentarios" ADD CONSTRAINT "os_comentarios_atividade_id_fkey"
      FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'os_comentarios_lidos_ordem_servico_id_fkey' AND conrelid = to_regclass('"os_comentarios_lidos"')
  ) THEN
    ALTER TABLE "os_comentarios_lidos" ADD CONSTRAINT "os_comentarios_lidos_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
