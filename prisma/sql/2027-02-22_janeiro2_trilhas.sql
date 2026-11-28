-- App do técnico: as TRILHAS da leva "App pronto pra janeiro 2", PR B.
--
--   1. "despesas_campo_historico" (tabela nova, D7): o colaborador corrige ou exclui pelo app a despesa de campo que o
--      escritório ainda não decidiu; cada correção (o que mudou) e cada exclusão (o que ela era) fica aqui. Sem chave
--      estrangeira para a despesa, de propósito: a linha da exclusão fica depois de a despesa sair.
--   2. "checklist_correcoes" (tabela nova, D13): o colaborador corrige pelo app o checklist do veículo do dia (até o fim
--      do dia); cada correção guarda o que mudou. "client_id" (único) faz o reenvio pela fila não aplicar duas vezes.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): só tabelas, índices e uma chave
-- estrangeira novos, nos nomes que o Prisma gera. Nada existente é removido nem alterado.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-22_janeiro2_trilhas.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "despesas_campo_historico" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "despesa_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "tecnico_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "acao" TEXT NOT NULL,
    "detalhes" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "despesas_campo_historico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "despesas_campo_historico_empresa_id_despesa_id_idx" ON "despesas_campo_historico"("empresa_id", "despesa_id");
CREATE INDEX IF NOT EXISTS "despesas_campo_historico_empresa_id_client_id_idx" ON "despesas_campo_historico"("empresa_id", "client_id");
CREATE INDEX IF NOT EXISTS "despesas_campo_historico_empresa_id_acao_criado_em_idx" ON "despesas_campo_historico"("empresa_id", "acao", "criado_em");

CREATE TABLE IF NOT EXISTS "checklist_correcoes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "checklist_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "detalhes" TEXT NOT NULL,
    "feito_em" TIMESTAMP(3) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_correcoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "checklist_correcoes_client_id_key" ON "checklist_correcoes"("client_id");
CREATE INDEX IF NOT EXISTS "checklist_correcoes_checklist_id_idx" ON "checklist_correcoes"("checklist_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_correcoes_checklist_id_fkey') THEN
    ALTER TABLE "checklist_correcoes" ADD CONSTRAINT "checklist_correcoes_checklist_id_fkey"
      FOREIGN KEY ("checklist_id") REFERENCES "checklist_preenchidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
