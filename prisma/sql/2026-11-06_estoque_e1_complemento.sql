-- Estoque — Leva E1 (complemento): tipo RESERVA no razão + "controla_estoque" no produto.
--
-- DEPENDE da Leva E1 (prisma/sql/2026-10-19_estoque_fundacao.sql): rode aquele antes deste.
-- Se a tabela "movimentacoes_estoque" ou o tipo "TipoMovimentacaoEstoque" não existirem, este
-- arquivo para com erro e não altera nada.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. valor 'RESERVA' no tipo "TipoMovimentacaoEstoque" (ENTRADA/SAIDA/AJUSTE/DEVOLUCAO/RESERVA):
--      já previsto para a Leva E4 (separação/consumo) encaixar sem migração nova. Ainda não é
--      gerado por nenhuma tela;
--   2. "produtos"."controla_estoque" (BOOLEAN NOT NULL, padrão true): o produto que não controla
--      estoque sai da tela Estoque e dos alertas (o cadastro continua igual). Todo produto existente
--      fica com true — coerente com a tela de hoje, que lista todos.
-- Nada é removido; nenhum dado existente muda (além do item 2, só o padrão novo).
--
-- O ALTER TYPE ... ADD VALUE fica FORA da transação de propósito: o PostgreSQL não aceita esse
-- comando dentro de um bloco de transação (e um valor novo só pode ser usado depois do commit).
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção, DEPOIS do SQL da E1:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-06_estoque_e1_complemento.sql

DO $$
BEGIN
  IF to_regclass('"movimentacoes_estoque"') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'TipoMovimentacaoEstoque' AND n.nspname = current_schema()
  ) THEN
    RAISE EXCEPTION 'Rode antes o SQL da Leva E1 (prisma/sql/2026-10-19_estoque_fundacao.sql): o razão de estoque não existe.';
  END IF;
END $$;

-- 1. Tipo RESERVA (idempotente: IF NOT EXISTS)
ALTER TYPE "TipoMovimentacaoEstoque" ADD VALUE IF NOT EXISTS 'RESERVA';

-- 2. O produto controla estoque? (padrão: sim)
ALTER TABLE "produtos" ADD COLUMN IF NOT EXISTS "controla_estoque" BOOLEAN NOT NULL DEFAULT true;

-- Conferência (opcional, só leitura) — o saldo de cada produto bate com a soma do razão:
--   SELECT p."id", p."nome", p."saldo", COALESCE(SUM(m."quantidade"), 0) AS "soma_razao"
--   FROM "produtos" p LEFT JOIN "movimentacoes_estoque" m ON m."produto_id" = p."id"
--   GROUP BY p."id" HAVING p."saldo" <> COALESCE(SUM(m."quantidade"), 0);
-- (a tela do extrato e a rota /api/estoque/:produto/recalcular corrigem o cache pelo histórico)
