-- Estoque — Leva E3.3b: materiais e peças na OS sem orçamento (o mesmo snapshot da E3.3, agora na OS).
--
-- Depende da E3.1 (tipo "ComportamentoFaturamento"): sem ela, este script PARA no começo, sem mexer em nada.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. tipos "TipoItemOs" (SERVICO / PRODUTO) e "OrigemMaterialOrcamento" (SOLTO / KIT / AVULSO; o da E3.3, só se faltar);
--   2. "os_itens_orcamento": tipo (SERVICO; item antigo continua serviço), servico_id / produto_id (vínculo com o
--      catálogo; linha livre = NULL), valor_base (NULL = sem composição), ajuste_materiais (0), valor_manual (false),
--      material_id (peça derivada; único), ordem (0) + FKs (catálogo SET NULL; material CASCADE);
--   3. tabela "os_materiais": o snapshot (produto, comportamento efetivo congelado, quantidade, quantidade_padrao,
--      valor_venda_unit, custo_unit, origem, kit_nome) + índices + FKs (CASCADE da OS e do item; SET NULL do produto).
-- OS antiga continua idêntica (todas as colunas novas têm padrão ou são nulas). Sem seed.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-07_materiais_os.sql

BEGIN;

-- 0. Pré-requisito (E3.1)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'ComportamentoFaturamento' AND n.nspname = current_schema()) THEN
    RAISE EXCEPTION 'Falta a leva E3.1: rode antes prisma/sql/2026-11-07_categoria_produto.sql';
  END IF;
END $$;

-- 1. Tipos
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'TipoItemOs' AND n.nspname = current_schema()) THEN
    CREATE TYPE "TipoItemOs" AS ENUM ('SERVICO', 'PRODUTO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'OrigemMaterialOrcamento' AND n.nspname = current_schema()) THEN
    CREATE TYPE "OrigemMaterialOrcamento" AS ENUM ('SOLTO', 'KIT', 'AVULSO');
  END IF;
END $$;

-- 2. Item da OS: tipo, catálogo, base/ajuste/manual, peça derivada, ordem
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "tipo" "TipoItemOs" NOT NULL DEFAULT 'SERVICO';
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "servico_id" TEXT;
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "produto_id" TEXT;
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "valor_base" DECIMAL(10,2);
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "ajuste_materiais" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "valor_manual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "material_id" TEXT;
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "ordem" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "os_itens_orcamento_material_id_key" ON "os_itens_orcamento"("material_id");

-- 3. Materiais da OS (snapshot)
CREATE TABLE IF NOT EXISTS "os_materiais" (
  "id" TEXT NOT NULL,
  "ordem_servico_id" TEXT NOT NULL,
  "os_item_id" TEXT NOT NULL,
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
  CONSTRAINT "os_materiais_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "os_materiais_ordem_servico_id_idx" ON "os_materiais"("ordem_servico_id");
CREATE INDEX IF NOT EXISTS "os_materiais_os_item_id_idx" ON "os_materiais"("os_item_id");
CREATE INDEX IF NOT EXISTS "os_materiais_produto_id_idx" ON "os_materiais"("produto_id");

-- 4. FKs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_materiais_ordem_servico_id_fkey' AND conrelid = '"os_materiais"'::regclass) THEN
    ALTER TABLE "os_materiais" ADD CONSTRAINT "os_materiais_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_materiais_os_item_id_fkey' AND conrelid = '"os_materiais"'::regclass) THEN
    ALTER TABLE "os_materiais" ADD CONSTRAINT "os_materiais_os_item_id_fkey"
      FOREIGN KEY ("os_item_id") REFERENCES "os_itens_orcamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_materiais_produto_id_fkey' AND conrelid = '"os_materiais"'::regclass) THEN
    ALTER TABLE "os_materiais" ADD CONSTRAINT "os_materiais_produto_id_fkey"
      FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_itens_orcamento_servico_id_fkey' AND conrelid = '"os_itens_orcamento"'::regclass) THEN
    ALTER TABLE "os_itens_orcamento" ADD CONSTRAINT "os_itens_orcamento_servico_id_fkey"
      FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_itens_orcamento_produto_id_fkey' AND conrelid = '"os_itens_orcamento"'::regclass) THEN
    ALTER TABLE "os_itens_orcamento" ADD CONSTRAINT "os_itens_orcamento_produto_id_fkey"
      FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_itens_orcamento_material_id_fkey' AND conrelid = '"os_itens_orcamento"'::regclass) THEN
    ALTER TABLE "os_itens_orcamento" ADD CONSTRAINT "os_itens_orcamento_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "os_materiais"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
