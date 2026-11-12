-- App do colaborador: "Permitir cadastrar equipamento em campo" (Equipes › App do colaborador), por
-- empresa, na tabela "configuracoes". Com a permissão LIGADA, o técnico cadastra pelo app, dentro da
-- OS, o equipamento que ainda não está na unidade; DESLIGADA, o app só vincula os já cadastrados
-- (o botão nem aparece e o servidor recusa).
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): só adiciona
-- UMA coluna, se ainda não existir. Nada é removido nem alterado. A coluna entra NOT NULL com
-- DEFAULT true — o padrão combinado com o produto: as empresas já cadastradas começam com a
-- permissão LIGADA.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-04_app_cadastrar_equipamento.sql

BEGIN;

ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_cadastrar_equipamento" BOOLEAN NOT NULL DEFAULT true;

COMMIT;
