-- Estoque — Leva E3.2: kits de material + composição do serviço ("Materiais padrão").
--
-- Depende da E3.1 (tipo "ComportamentoFaturamento", prisma/sql/2026-11-07_categoria_produto.sql): sem ela,
-- este script PARA no começo, sem mexer em nada.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. tabela "kits_material" (empresa, nome, descricao, ativo, criado_em/atualizado_em)
--      + índice (empresa_id, ativo) + chave estrangeira da empresa (CASCADE);
--   2. tabela "kit_material_itens" (kit, produto, quantidade, ordem) + índices + FKs (CASCADE: some o kit ou o
--      produto, some o item);
--   3. tabela "servico_materiais" (serviço → produto OU kit, quantidade, comportamento = override opcional, ordem)
--      + índices + FKs (CASCADE). Produto sem override usa o comportamento da categoria (lib/estoque/composicao.ts).
-- Nenhum dado existente muda; serviço sem composição continua como hoje. Não há seed.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-07_composicao_servico_kits.sql

BEGIN;

-- 0. Pré-requisito (E3.1)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'ComportamentoFaturamento' AND n.nspname = current_schema()) THEN
    RAISE EXCEPTION 'Falta a leva E3.1: rode antes prisma/sql/2026-11-07_categoria_produto.sql';
  END IF;
END $$;

-- 1. Kits de material
CREATE TABLE IF NOT EXISTS "kits_material" (
  "id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "descricao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kits_material_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "kits_material_empresa_id_ativo_idx" ON "kits_material"("empresa_id", "ativo");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kits_material_empresa_id_fkey' AND conrelid = '"kits_material"'::regclass) THEN
    ALTER TABLE "kits_material" ADD CONSTRAINT "kits_material_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. Itens do kit
CREATE TABLE IF NOT EXISTS "kit_material_itens" (
  "id" TEXT NOT NULL,
  "kit_id" TEXT NOT NULL,
  "produto_id" TEXT NOT NULL,
  "quantidade" DECIMAL(12,3) NOT NULL,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "kit_material_itens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "kit_material_itens_kit_id_idx" ON "kit_material_itens"("kit_id");
CREATE INDEX IF NOT EXISTS "kit_material_itens_produto_id_idx" ON "kit_material_itens"("produto_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kit_material_itens_kit_id_fkey' AND conrelid = '"kit_material_itens"'::regclass) THEN
    ALTER TABLE "kit_material_itens" ADD CONSTRAINT "kit_material_itens_kit_id_fkey"
      FOREIGN KEY ("kit_id") REFERENCES "kits_material"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kit_material_itens_produto_id_fkey' AND conrelid = '"kit_material_itens"'::regclass) THEN
    ALTER TABLE "kit_material_itens" ADD CONSTRAINT "kit_material_itens_produto_id_fkey"
      FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Composição do serviço (materiais padrão)
CREATE TABLE IF NOT EXISTS "servico_materiais" (
  "id" TEXT NOT NULL,
  "servico_id" TEXT NOT NULL,
  "produto_id" TEXT,
  "kit_id" TEXT,
  "quantidade" DECIMAL(12,3) NOT NULL,
  "comportamento" "ComportamentoFaturamento",
  "ordem" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "servico_materiais_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "servico_materiais_servico_id_idx" ON "servico_materiais"("servico_id");
CREATE INDEX IF NOT EXISTS "servico_materiais_produto_id_idx" ON "servico_materiais"("produto_id");
CREATE INDEX IF NOT EXISTS "servico_materiais_kit_id_idx" ON "servico_materiais"("kit_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servico_materiais_servico_id_fkey' AND conrelid = '"servico_materiais"'::regclass) THEN
    ALTER TABLE "servico_materiais" ADD CONSTRAINT "servico_materiais_servico_id_fkey"
      FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servico_materiais_produto_id_fkey' AND conrelid = '"servico_materiais"'::regclass) THEN
    ALTER TABLE "servico_materiais" ADD CONSTRAINT "servico_materiais_produto_id_fkey"
      FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servico_materiais_kit_id_fkey' AND conrelid = '"servico_materiais"'::regclass) THEN
    ALTER TABLE "servico_materiais" ADD CONSTRAINT "servico_materiais_kit_id_fkey"
      FOREIGN KEY ("kit_id") REFERENCES "kits_material"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
