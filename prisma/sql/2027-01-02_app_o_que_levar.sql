-- App do técnico: "O que levar" (materiais previstos das OS, para carregar o veículo antes de sair).
--
--   "configuracoes"."app_o_que_levar": a opção "Mostrar "O que levar" (materiais previstos)"
--   (Equipes › App do colaborador), por empresa. NOT NULL com DEFAULT true — as empresas já
--   cadastradas começam com a opção LIGADA. Desligada, os materiais nem saem do servidor para o app.
--
-- É só uma opção de exibição: nenhum material, estoque ou OS é criado, alterado ou baixado.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): UMA coluna nova.
-- Nada existente é removido nem alterado; rodar de novo não religa o que a empresa desligou.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-02_app_o_que_levar.sql

BEGIN;

ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_o_que_levar" BOOLEAN NOT NULL DEFAULT true;

COMMIT;
