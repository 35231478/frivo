-- PMOC — Etapa 1 (parte 1 de 2 do SQL): o tipo do status do plano.
-- PASSO 1 DE 2. Rodar ANTES do passo 2 (prisma/sql/2026-10-06_pmoc_etapa1_2.sql), em execução
-- SEPARADA — é o padrão da casa para enum. (Aqui o tipo é NOVO, criado por CREATE TYPE; o PostgreSQL
-- só exige a separação quando se acrescenta valor a um enum que já existe. Rodar separado não custa
-- nada e mantém a regra única.)
-- ADITIVO e IDEMPOTENTE: só cria o tipo se ele ainda não existir; pode rodar 2× sem efeito extra.
-- Nada existente é alterado nem apagado.
--
-- O que fica gravado é só RASCUNHO ou PUBLICADO. "Vigente" e "Expirado" são calculados pelas datas
-- na aplicação (lib/pmoc.ts) — não são valores deste tipo.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-06_pmoc_etapa1_1_enum.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'StatusPmoc' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "StatusPmoc" AS ENUM ('RASCUNHO', 'PUBLICADO');
  END IF;
END $$;
