-- App do técnico: as TRILHAS da leva "App pronto pra janeiro 2", PR B.
--
--   1. "despesas_campo_historico" (tabela nova, D7): o colaborador corrige ou exclui pelo app a despesa de campo que o
--      escritório ainda não decidiu; cada correção (o que mudou) e cada exclusão (o que ela era) fica aqui. Sem chave
--      estrangeira para a despesa, de propósito: a linha da exclusão fica depois de a despesa sair.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): só tabela e índices novos, nos
-- nomes que o Prisma gera. Nada existente é removido nem alterado.
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

COMMIT;
