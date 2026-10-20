-- Relatório da OS — configuração de impressão por empresa.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   ADD COLUMN IF NOT EXISTS "relatorio_os_config" (JSONB, opcional) em "configuracoes".
--   Guarda, por empresa, quais seções do relatório da OS aparecem e quem vê cada uma
--   (versão do cliente × só a versão interna). Vazio (NULL) = os padrões do sistema, ou seja,
--   o relatório continua saindo completo para o cliente até alguém mudar a configuração.
-- Nada é removido nem alterado nos dados existentes.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-20_relatorio_os_config.sql

ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "relatorio_os_config" JSONB;
