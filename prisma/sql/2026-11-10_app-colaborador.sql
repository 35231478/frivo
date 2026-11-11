-- App do colaborador (modo técnico): permissões/autorizações do app, por empresa (tabela
-- "configuracoes"), e o nonce de "apenas um dispositivo ativo" por colaborador (tabela "usuarios").
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): só adiciona
-- colunas que ainda não existem. Nada é removido. As flags booleanas entram NOT NULL com o DEFAULT
-- combinado com o produto — então as empresas já cadastradas passam a valer esses padrões (ex.:
-- esconder valores, marca d'água e um dispositivo já começam LIGADOS). "usuarios.sessao_ativa" é
-- NULA (o próximo login de cada colaborador grava o nonce).
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-10_app-colaborador.sql

BEGIN;

-- Privacidade e comercial
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_exibir_dados_cliente"    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_exibir_contatos_cliente" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_esconder_valores"        BOOLEAN NOT NULL DEFAULT true;

-- Execução e prova
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_marca_dagua"             BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_marca_dagua_os"          BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_marca_dagua_endereco"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_marca_dagua_coordenadas" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_exigir_localizacao"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_foto_somente_camera"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_conclusao_obrigatoria"   BOOLEAN NOT NULL DEFAULT false;

-- Dispositivo
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_um_dispositivo"          BOOLEAN NOT NULL DEFAULT true;

-- Nonce do dispositivo ativo por colaborador (NULA; o próximo login grava)
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "sessao_ativa" TEXT;

COMMIT;
