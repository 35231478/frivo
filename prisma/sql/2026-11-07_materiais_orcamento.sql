-- Estoque — Leva E3.3: materiais e peças no orçamento (snapshot por linha de serviço).
--
-- Depende da E3.1 (tipo "ComportamentoFaturamento"): sem ela, este script PARA no começo, sem mexer em nada.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. tipo "OrigemMaterialOrcamento" (SOLTO / KIT / AVULSO);
--   2. "orcamento_servicos": valor_base (antes dos materiais; NULL = linha sem composição), ajuste_materiais (0),
--      valor_manual (false) — o valor_total continua sendo o que vale (o que a OS, a fatura e a nota leem);
--   3. tabela "orcamento_materiais": o snapshot (produto, comportamento efetivo congelado, quantidade,
--      quantidade_padrao, valor_venda_unit, custo_unit, origem, kit_nome) + índices + FKs (CASCADE do orçamento
--      e da linha de serviço; SET NULL do produto);
--   4. "orcamento_produtos".material_id (peça "venda à parte" derivada de um material; único; CASCADE).
-- Nenhum dado existente muda: orçamento sem materiais continua exatamente como está. Sem seed.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-07_materiais_orcamento.sql

BEGIN;

-- 0. Pré-requisito (E3.1)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'ComportamentoFaturamento' AND n.nspname = current_schema()) THEN
    RAISE EXCEPTION 'Falta a leva E3.1: rode antes prisma/sql/2026-11-07_categoria_produto.sql';
  END IF;
END $$;

-- 1. Tipo
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'OrigemMaterialOrcamento' AND n.nspname = current_schema()) THEN
    CREATE TYPE "OrigemMaterialOrcamento" AS ENUM ('SOLTO', 'KIT', 'AVULSO');
  END IF;
END $$;

-- 2. Linha de serviço: base, ajuste e override
ALTER TABLE "orcamento_servicos" ADD COLUMN IF NOT EXISTS "valor_base" DECIMAL(12,2);
ALTER TABLE "orcamento_servicos" ADD COLUMN IF NOT EXISTS "ajuste_materiais" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "orcamento_servicos" ADD COLUMN IF NOT EXISTS "valor_manual" BOOLEAN NOT NULL DEFAULT false;

-- 3. Materiais do orçamento (snapshot)
CREATE TABLE IF NOT EXISTS "orcamento_materiais" (
  "id" TEXT NOT NULL,
  "orcamento_id" TEXT NOT NULL,
  "orcamento_servico_id" TEXT NOT NULL,
  "produto_id" TEXT,
  "descricao" TEXT NOT NULL,
  "unidade" TEXT NOT NULL DEFAULT 'un',
  "comportamento" "ComportamentoFaturamento" NOT NULL,
  "quantidade" DECIMAL(12,3) NOT NULL,
  "quantidade_padrao" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "valor_venda_unit" DECIMAL(12,2) NOT NULL,
  "custo_unit" DECIMAL(14,4),
  "origem" "OrigemMaterialOrcamento" NOT NULL DEFAULT 'AVULSO',
  "kit_nome" TEXT,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "orcamento_materiais_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "orcamento_materiais_orcamento_id_idx" ON "orcamento_materiais"("orcamento_id");
CREATE INDEX IF NOT EXISTS "orcamento_materiais_orcamento_servico_id_idx" ON "orcamento_materiais"("orcamento_servico_id");
CREATE INDEX IF NOT EXISTS "orcamento_materiais_produto_id_idx" ON "orcamento_materiais"("produto_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orcamento_materiais_orcamento_id_fkey' AND conrelid = '"orcamento_materiais"'::regclass) THEN
    ALTER TABLE "orcamento_materiais" ADD CONSTRAINT "orcamento_materiais_orcamento_id_fkey"
      FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orcamento_materiais_orcamento_servico_id_fkey' AND conrelid = '"orcamento_materiais"'::regclass) THEN
    ALTER TABLE "orcamento_materiais" ADD CONSTRAINT "orcamento_materiais_orcamento_servico_id_fkey"
      FOREIGN KEY ("orcamento_servico_id") REFERENCES "orcamento_servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orcamento_materiais_produto_id_fkey' AND conrelid = '"orcamento_materiais"'::regclass) THEN
    ALTER TABLE "orcamento_materiais" ADD CONSTRAINT "orcamento_materiais_produto_id_fkey"
      FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Peça derivada: a linha de produto aponta para o material de origem
ALTER TABLE "orcamento_produtos" ADD COLUMN IF NOT EXISTS "material_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "orcamento_produtos_material_id_key" ON "orcamento_produtos"("material_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orcamento_produtos_material_id_fkey' AND conrelid = '"orcamento_produtos"'::regclass) THEN
    ALTER TABLE "orcamento_produtos" ADD CONSTRAINT "orcamento_produtos_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "orcamento_materiais"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
