-- App do técnico: ATIVIDADE ESQUECIDA EM ANDAMENTO (leva app-campo 1, PR 2).
--
--   1. "atividades_os"."iniciada_em" (coluna nova, TIMESTAMP(3), opcional): quando a atividade começou — a 1ª
--      gravação no app, pela hora do toque; reabrir recomeça. As atividades que já existem ficam VAZIAS (nada é
--      reescrito): para elas, o app e o sino usam a hora agendada.
--   2. "configuracoes"."app_alerta_andamento_horas" (coluna nova, INTEGER NOT NULL DEFAULT 4): depois de quantas
--      horas em andamento o app avisa o técnico e o sino avisa o gestor (Equipes › App do colaborador). As
--      empresas já cadastradas começam com 4 horas.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): DUAS colunas novas, nos
-- nomes e tipos que o Prisma gera. Nada existente é removido nem alterado.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-02_app_atividade_esquecida.sql

BEGIN;

ALTER TABLE "atividades_os" ADD COLUMN IF NOT EXISTS "iniciada_em" TIMESTAMP(3);
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_alerta_andamento_horas" INTEGER NOT NULL DEFAULT 4;

COMMIT;
