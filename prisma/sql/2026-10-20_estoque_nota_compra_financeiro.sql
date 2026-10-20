-- Estoque — Leva E2.1: conciliação de NF completa (central de lançamento) + centro de custo + boleto.
--
-- DEPENDE da Leva E2 (prisma/sql/2026-10-20_estoque_nota_compra.sql, versão com o ajuste de conversão
-- de unidade): rode aquele antes deste. Se a E2 não estiver no banco (tabela "notas_compra" ou a
-- coluna "notas_compra_itens"."fator_conversao" não existir), este arquivo para com erro e não altera nada.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. tabela "centros_custo" (novo cadastro: empresa, nome, ativo, criado_em/atualizado_em);
--   2. "contas_pagar": "centro_custo_id" (opcional) e o boleto da conta — "linha_digitavel" (47/48
--      dígitos) e "codigo_barras_boleto" (44). A forma de pagamento ("forma_pagamento") JÁ existia;
--   3. "fornecedores": "categoria_padrao_id" e "centro_custo_padrao_id" (padrões aprendidos na nota);
--   4. "notas_compra": o rascunho do lançamento — "categoria_id", "centro_custo_id", "forma_pagamento"
--      e "parcelas" (JSONB; vazio = as duplicatas da NF);
--   5. "notas_compra_itens": "preco_venda" e "margem_venda" (preço definido na linha da conciliação,
--      aplicado ao produto só ao lançar).
-- Toda chave estrangeira nova é opcional e ON DELETE SET NULL. Índices e chaves estrangeiras com os
-- mesmos nomes que o Prisma usa. Nada é removido; nenhum dado existente muda.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção, DEPOIS do SQL da E2:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-20_estoque_nota_compra_financeiro.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('"notas_compra"') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'notas_compra_itens' AND column_name = 'fator_conversao'
  ) THEN
    RAISE EXCEPTION 'Rode antes o SQL da Leva E2 (prisma/sql/2026-10-20_estoque_nota_compra.sql, versão com o ajuste): as tabelas da nota de compra não estão completas.';
  END IF;
END $$;

-- 1. Centros de custo
CREATE TABLE IF NOT EXISTS "centros_custo" (
  "id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "centros_custo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "centros_custo_empresa_id_ativo_idx" ON "centros_custo"("empresa_id", "ativo");

-- 2. Conta a pagar: centro de custo e boleto
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "centro_custo_id" TEXT;
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "linha_digitavel" TEXT;
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "codigo_barras_boleto" TEXT;
CREATE INDEX IF NOT EXISTS "contas_pagar_centro_custo_id_idx" ON "contas_pagar"("centro_custo_id");

-- 3. Fornecedor: padrões aprendidos
ALTER TABLE "fornecedores" ADD COLUMN IF NOT EXISTS "categoria_padrao_id" TEXT;
ALTER TABLE "fornecedores" ADD COLUMN IF NOT EXISTS "centro_custo_padrao_id" TEXT;
CREATE INDEX IF NOT EXISTS "fornecedores_categoria_padrao_id_idx" ON "fornecedores"("categoria_padrao_id");
CREATE INDEX IF NOT EXISTS "fornecedores_centro_custo_padrao_id_idx" ON "fornecedores"("centro_custo_padrao_id");

-- 4. Nota de compra: rascunho do lançamento financeiro
ALTER TABLE "notas_compra" ADD COLUMN IF NOT EXISTS "categoria_id" TEXT;
ALTER TABLE "notas_compra" ADD COLUMN IF NOT EXISTS "centro_custo_id" TEXT;
ALTER TABLE "notas_compra" ADD COLUMN IF NOT EXISTS "forma_pagamento" "FormaPagamento";
ALTER TABLE "notas_compra" ADD COLUMN IF NOT EXISTS "parcelas" JSONB;
CREATE INDEX IF NOT EXISTS "notas_compra_categoria_id_idx" ON "notas_compra"("categoria_id");
CREATE INDEX IF NOT EXISTS "notas_compra_centro_custo_id_idx" ON "notas_compra"("centro_custo_id");

-- 5. Itens da nota: preço de venda definido na linha (rascunho)
ALTER TABLE "notas_compra_itens" ADD COLUMN IF NOT EXISTS "preco_venda" DECIMAL(12,2);
ALTER TABLE "notas_compra_itens" ADD COLUMN IF NOT EXISTS "margem_venda" DECIMAL(5,2);

-- Chaves estrangeiras (só as que ainda não existem)
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('centros_custo', 'centros_custo_empresa_id_fkey', 'ALTER TABLE "centros_custo" ADD CONSTRAINT "centros_custo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('contas_pagar', 'contas_pagar_centro_custo_id_fkey', 'ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('fornecedores', 'fornecedores_categoria_padrao_id_fkey', 'ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_categoria_padrao_id_fkey" FOREIGN KEY ("categoria_padrao_id") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('fornecedores', 'fornecedores_centro_custo_padrao_id_fkey', 'ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_centro_custo_padrao_id_fkey" FOREIGN KEY ("centro_custo_padrao_id") REFERENCES "centros_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_compra', 'notas_compra_categoria_id_fkey', 'ALTER TABLE "notas_compra" ADD CONSTRAINT "notas_compra_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_compra', 'notas_compra_centro_custo_id_fkey', 'ALTER TABLE "notas_compra" ADD CONSTRAINT "notas_compra_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE')
  ) AS t(tabela, nome, ddl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome AND conrelid = format('%I', fk.tabela)::regclass) THEN
      EXECUTE fk.ddl;
    END IF;
  END LOOP;
END $$;

COMMIT;
