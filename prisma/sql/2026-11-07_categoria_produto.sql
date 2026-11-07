-- Estoque — Leva E3.1: categoria de produto com comportamento de faturamento.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. tipo "ComportamentoFaturamento" (VENDA_A_PARTE / INCLUSO_NO_SERVICO), só se ainda não existe;
--   2. tabela "categorias_produto" (empresa, nome, comportamento, ativo, criado_em/atualizado_em)
--      + índice (empresa_id, ativo) + chave estrangeira da empresa (CASCADE);
--   3. "produtos"."categoria_produto_id" (opcional; SET NULL se a categoria sumir) + índice + FK.
--      Produto sem categoria é tratado como "incluso no serviço" (lib/estoque/categoria.ts);
--   4. seed das duas categorias do Zé em cada empresa que ainda NÃO TEM NENHUMA categoria
--      ("Peças de reposição" → venda à parte; "Materiais de instalação/consumo" → incluso no serviço).
--      Ids determinísticos por empresa: rodar de novo não duplica; empresa que já tem categoria
--      (renomeou, inativou, criou outra) não é tocada. Empresas criadas depois recebem o seed pelo
--      sistema, na primeira vez que o cadastro é listado.
-- Nada é removido; nenhum dado existente muda.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-11-07_categoria_produto.sql

BEGIN;

-- 1. Tipo
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'ComportamentoFaturamento' AND n.nspname = current_schema()) THEN
    CREATE TYPE "ComportamentoFaturamento" AS ENUM ('VENDA_A_PARTE', 'INCLUSO_NO_SERVICO');
  END IF;
END $$;

-- 2. Categorias de produto
CREATE TABLE IF NOT EXISTS "categorias_produto" (
  "id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "comportamento" "ComportamentoFaturamento" NOT NULL DEFAULT 'INCLUSO_NO_SERVICO',
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "categorias_produto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "categorias_produto_empresa_id_ativo_idx" ON "categorias_produto"("empresa_id", "ativo");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categorias_produto_empresa_id_fkey' AND conrelid = '"categorias_produto"'::regclass) THEN
    ALTER TABLE "categorias_produto" ADD CONSTRAINT "categorias_produto_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. O vínculo no produto (opcional)
ALTER TABLE "produtos" ADD COLUMN IF NOT EXISTS "categoria_produto_id" TEXT;
CREATE INDEX IF NOT EXISTS "produtos_categoria_produto_id_idx" ON "produtos"("categoria_produto_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produtos_categoria_produto_id_fkey' AND conrelid = '"produtos"'::regclass) THEN
    ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_produto_id_fkey"
      FOREIGN KEY ("categoria_produto_id") REFERENCES "categorias_produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Seed por empresa (só em quem não tem nenhuma categoria)
INSERT INTO "categorias_produto" ("id", "empresa_id", "nome", "comportamento", "ativo")
SELECT 'catp_' || e."id" || '_pecas', e."id", 'Peças de reposição', 'VENDA_A_PARTE', true
FROM "empresas" e
WHERE NOT EXISTS (SELECT 1 FROM "categorias_produto" c WHERE c."empresa_id" = e."id")
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "categorias_produto" ("id", "empresa_id", "nome", "comportamento", "ativo")
SELECT 'catp_' || e."id" || '_materiais', e."id", 'Materiais de instalação/consumo', 'INCLUSO_NO_SERVICO', true
FROM "empresas" e
WHERE NOT EXISTS (SELECT 1 FROM "categorias_produto" c WHERE c."empresa_id" = e."id" AND c."id" <> 'catp_' || e."id" || '_pecas')
ON CONFLICT ("id") DO NOTHING;

COMMIT;
