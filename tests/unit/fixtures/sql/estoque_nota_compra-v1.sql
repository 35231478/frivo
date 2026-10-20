-- CÓPIA da 1ª versão de prisma/sql/2026-10-20_estoque_nota_compra.sql (commit dba91b5), a que pode já ter
-- rodado em produção. Só para o teste provar que a versão nova roda por cima dela. NÃO rodar.
-- Estoque — Leva E2: entrada por NF-e de compra (XML) → produtos + estoque + contas a pagar.
--
-- DEPENDE da Leva E1 (prisma/sql/2026-10-19_estoque_fundacao.sql): rode aquele antes deste.
-- Se a tabela "movimentacoes_estoque" não existir, este arquivo para com erro e não altera nada.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. tipo "StatusNotaCompra" (IMPORTADA/CONCILIADA/LANCADA), só se ainda não existe;
--   2. tabela "notas_compra" (a NF importada: fornecedor, chave de acesso ÚNICA por empresa,
--      número, série, emissão, valor, status, XML original, duplicatas, pedido de compra opcional);
--   3. tabela "notas_compra_itens" (itens da NF; produto_id preenchido na conciliação);
--   4. tabela "de_para_produto_fornecedor" (código do item no fornecedor → produto; aprende);
--   5. "contas_pagar"."nota_compra_id" (opcional) — a conta a pagar gerada pela nota;
--   6. "movimentacoes_estoque"."custo_unitario" passa de DECIMAL(12,2) para DECIMAL(14,4): a NF
--      traz custo unitário com mais de 2 casas (alargar não perde nenhum valor existente).
-- Índices e chaves estrangeiras com os mesmos nomes que o Prisma usa.
-- Nada é removido; nenhum dado existente muda.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-20_estoque_nota_compra.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('"movimentacoes_estoque"') IS NULL THEN
    RAISE EXCEPTION 'Rode antes o SQL da Leva E1 (prisma/sql/2026-10-19_estoque_fundacao.sql): a tabela movimentacoes_estoque não existe.';
  END IF;
END $$;

-- 1. Tipo
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'StatusNotaCompra' AND n.nspname = current_schema()) THEN
    CREATE TYPE "StatusNotaCompra" AS ENUM ('IMPORTADA', 'CONCILIADA', 'LANCADA');
  END IF;
END $$;

-- 2. Notas
CREATE TABLE IF NOT EXISTS "notas_compra" (
  "id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "fornecedor_id" TEXT NOT NULL,
  "chave_acesso" TEXT NOT NULL,
  "numero" TEXT NOT NULL,
  "serie" TEXT NOT NULL,
  "data_emissao" TIMESTAMP(3) NOT NULL,
  "valor_total" DECIMAL(12,2) NOT NULL,
  "status" "StatusNotaCompra" NOT NULL DEFAULT 'IMPORTADA',
  "xml" TEXT NOT NULL,
  "emitente_nome" TEXT NOT NULL,
  "emitente_cnpj" TEXT NOT NULL,
  "duplicatas" JSONB NOT NULL DEFAULT '[]',
  "pedido_compra_id" TEXT,
  "usuario_id" TEXT,
  "lancada_em" TIMESTAMP(3),
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notas_compra_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "notas_compra_empresa_id_chave_acesso_key" ON "notas_compra"("empresa_id", "chave_acesso");
CREATE INDEX IF NOT EXISTS "notas_compra_empresa_id_status_criado_em_idx" ON "notas_compra"("empresa_id", "status", "criado_em");
CREATE INDEX IF NOT EXISTS "notas_compra_fornecedor_id_idx" ON "notas_compra"("fornecedor_id");

-- 3. Itens
CREATE TABLE IF NOT EXISTS "notas_compra_itens" (
  "id" TEXT NOT NULL,
  "nota_id" TEXT NOT NULL,
  "numero_item" INTEGER NOT NULL,
  "codigo_fornecedor" TEXT NOT NULL,
  "descricao_fornecedor" TEXT NOT NULL,
  "ncm" TEXT,
  "cfop" TEXT,
  "unidade" TEXT NOT NULL,
  "quantidade" DECIMAL(15,4) NOT NULL,
  "valor_unitario" DECIMAL(15,4) NOT NULL,
  "valor_total" DECIMAL(12,2) NOT NULL,
  "produto_id" TEXT,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notas_compra_itens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "notas_compra_itens_nota_id_numero_item_key" ON "notas_compra_itens"("nota_id", "numero_item");
CREATE INDEX IF NOT EXISTS "notas_compra_itens_produto_id_idx" ON "notas_compra_itens"("produto_id");

-- 4. De-para (aprende)
CREATE TABLE IF NOT EXISTS "de_para_produto_fornecedor" (
  "id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "fornecedor_id" TEXT NOT NULL,
  "codigo_fornecedor" TEXT NOT NULL,
  "descricao_fornecedor" TEXT NOT NULL,
  "produto_id" TEXT NOT NULL,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "de_para_produto_fornecedor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "de_para_produto_fornecedor_empresa_id_fornecedor_id_codigo__key" ON "de_para_produto_fornecedor"("empresa_id", "fornecedor_id", "codigo_fornecedor");
CREATE INDEX IF NOT EXISTS "de_para_produto_fornecedor_produto_id_idx" ON "de_para_produto_fornecedor"("produto_id");

-- 5. Conta a pagar ← nota
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "nota_compra_id" TEXT;
CREATE INDEX IF NOT EXISTS "contas_pagar_nota_compra_id_idx" ON "contas_pagar"("nota_compra_id");

-- 6. Custo unitário com 4 casas (só alarga; rodar de novo não muda nada)
ALTER TABLE "movimentacoes_estoque" ALTER COLUMN "custo_unitario" SET DATA TYPE DECIMAL(14,4);

-- Chaves estrangeiras (só as que ainda não existem)
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('contas_pagar', 'contas_pagar_nota_compra_id_fkey', 'ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_nota_compra_id_fkey" FOREIGN KEY ("nota_compra_id") REFERENCES "notas_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_compra', 'notas_compra_empresa_id_fkey', 'ALTER TABLE "notas_compra" ADD CONSTRAINT "notas_compra_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('notas_compra', 'notas_compra_fornecedor_id_fkey', 'ALTER TABLE "notas_compra" ADD CONSTRAINT "notas_compra_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE'),
    ('notas_compra', 'notas_compra_pedido_compra_id_fkey', 'ALTER TABLE "notas_compra" ADD CONSTRAINT "notas_compra_pedido_compra_id_fkey" FOREIGN KEY ("pedido_compra_id") REFERENCES "pedidos_compra_interno"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_compra', 'notas_compra_usuario_id_fkey', 'ALTER TABLE "notas_compra" ADD CONSTRAINT "notas_compra_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_compra_itens', 'notas_compra_itens_nota_id_fkey', 'ALTER TABLE "notas_compra_itens" ADD CONSTRAINT "notas_compra_itens_nota_id_fkey" FOREIGN KEY ("nota_id") REFERENCES "notas_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('notas_compra_itens', 'notas_compra_itens_produto_id_fkey', 'ALTER TABLE "notas_compra_itens" ADD CONSTRAINT "notas_compra_itens_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('de_para_produto_fornecedor', 'de_para_produto_fornecedor_empresa_id_fkey', 'ALTER TABLE "de_para_produto_fornecedor" ADD CONSTRAINT "de_para_produto_fornecedor_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('de_para_produto_fornecedor', 'de_para_produto_fornecedor_fornecedor_id_fkey', 'ALTER TABLE "de_para_produto_fornecedor" ADD CONSTRAINT "de_para_produto_fornecedor_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('de_para_produto_fornecedor', 'de_para_produto_fornecedor_produto_id_fkey', 'ALTER TABLE "de_para_produto_fornecedor" ADD CONSTRAINT "de_para_produto_fornecedor_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE')
  ) AS t(tabela, nome, ddl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome AND conrelid = format('%I', fk.tabela)::regclass) THEN
      EXECUTE fk.ddl;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Conferência (opcional, só leitura) — notas lançadas sem conta a pagar ou sem entrada no estoque:
--   SELECT n."id", n."numero" FROM "notas_compra" n
--   WHERE n."status" = 'LANCADA' AND (NOT EXISTS (SELECT 1 FROM "contas_pagar" c WHERE c."nota_compra_id" = n."id")
--     OR NOT EXISTS (SELECT 1 FROM "movimentacoes_estoque" m WHERE m."origem" = 'COMPRA' AND m."ref_id" = n."id"));
