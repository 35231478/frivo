-- Estoque — Leva E1: fundação (razão de movimentações + saldo no produto + permissão "Estoque").
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. tipos "TipoMovimentacaoEstoque" (ENTRADA/SAIDA/AJUSTE/DEVOLUCAO) e
--      "OrigemMovimentacaoEstoque" (COMPRA/OS/AJUSTE/INVENTARIO), só se ainda não existem;
--   2. ADD COLUMN IF NOT EXISTS "saldo" em produtos (DECIMAL(12,3), NOT NULL, padrão 0). Hoje não
--      existe estoque nenhum: todo produto começa com saldo 0 — coerente com o razão vazio;
--   3. CREATE TABLE IF NOT EXISTS "movimentacoes_estoque" (o razão: quantidade COM SINAL, saldo
--      depois do movimento, custo, origem, documento de origem, quem fez, quando; "local_id" opcional
--      e ainda sem uso, para estoque por veículo/almoxarifado no futuro) + índices + chaves
--      estrangeiras (produto: RESTRICT — produto com histórico não some; usuário: SET NULL);
--   4. permissão nova "estoque" (visualizar/gerenciar): os perfis do tipo ADMINISTRADOR ganham as
--      duas, como os demais módulos; os outros perfis ficam SEM acesso até alguém marcar em
--      Configurações › Perfis de acesso. Perfil que já tem a chave "estoque" não é tocado.
--      (Usuário com role ADMIN já tem acesso total, com ou sem perfil.)
-- Nada é removido nem alterado nos dados existentes (além do item 4).
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-19_estoque_fundacao.sql

BEGIN;

-- 1. Tipos
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'TipoMovimentacaoEstoque' AND n.nspname = current_schema()) THEN
    CREATE TYPE "TipoMovimentacaoEstoque" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'DEVOLUCAO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'OrigemMovimentacaoEstoque' AND n.nspname = current_schema()) THEN
    CREATE TYPE "OrigemMovimentacaoEstoque" AS ENUM ('COMPRA', 'OS', 'AJUSTE', 'INVENTARIO');
  END IF;
END $$;

-- 2. Saldo (cache) no produto
ALTER TABLE "produtos" ADD COLUMN IF NOT EXISTS "saldo" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- 3. Razão de movimentações
CREATE TABLE IF NOT EXISTS "movimentacoes_estoque" (
  "id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "produto_id" TEXT NOT NULL,
  "tipo" "TipoMovimentacaoEstoque" NOT NULL,
  "origem" "OrigemMovimentacaoEstoque" NOT NULL,
  "quantidade" DECIMAL(12,3) NOT NULL,
  "saldo_apos" DECIMAL(12,3) NOT NULL,
  "custo_unitario" DECIMAL(12,2),
  "ref_id" TEXT,
  "observacao" TEXT,
  "usuario_id" TEXT,
  "local_id" TEXT,
  "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "movimentacoes_estoque_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "movimentacoes_estoque_empresa_id_produto_id_data_idx" ON "movimentacoes_estoque"("empresa_id", "produto_id", "data");
CREATE INDEX IF NOT EXISTS "movimentacoes_estoque_empresa_id_data_idx" ON "movimentacoes_estoque"("empresa_id", "data");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimentacoes_estoque_empresa_id_fkey' AND conrelid = '"movimentacoes_estoque"'::regclass) THEN
    ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimentacoes_estoque_produto_id_fkey' AND conrelid = '"movimentacoes_estoque"'::regclass) THEN
    ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_produto_id_fkey"
      FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimentacoes_estoque_usuario_id_fkey' AND conrelid = '"movimentacoes_estoque"'::regclass) THEN
    ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Permissão "estoque" para os perfis Administrador (só se ainda não têm a chave)
UPDATE "perfis_acesso"
SET "permissoes" = jsonb_set("permissoes"::jsonb, '{estoque}', '{"visualizar": true, "gerenciar": true}'::jsonb)
WHERE "tipo" = 'ADMINISTRADOR'
  AND jsonb_typeof("permissoes"::jsonb) = 'object'
  AND NOT ("permissoes"::jsonb ? 'estoque');

COMMIT;

-- Conferência (opcional, só leitura) — o saldo de cada produto bate com a soma do razão:
--   SELECT p."id", p."nome", p."saldo", COALESCE(SUM(m."quantidade"), 0) AS "soma_razao"
--   FROM "produtos" p LEFT JOIN "movimentacoes_estoque" m ON m."produto_id" = p."id"
--   GROUP BY p."id" HAVING p."saldo" <> COALESCE(SUM(m."quantidade"), 0);
