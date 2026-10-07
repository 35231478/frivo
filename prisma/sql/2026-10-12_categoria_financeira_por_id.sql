-- Leva 5.1 — categoria financeira por ID nas contas a receber e a pagar.
-- Antes a conta a receber guardava só o NOME da categoria (coluna "categoria"): renomear a categoria
-- "desligava" as contas antigas (sumiam a cor e o filtro). Agora o vínculo é "categoria_id".
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. ADD COLUMN IF NOT EXISTS "categoria_id" nas duas tabelas (nada é removido; a coluna de nome
--      "categoria" da conta a receber continua, como histórico/fallback);
--   2. FK para categorias_financeiras com ON DELETE SET NULL e índices (só cria se não existir);
--   3. migração de dados: preenche "categoria_id" das contas a receber casando o NOME atual com uma
--      categoria DA MESMA EMPRESA (igualdade exata). Só mexe em conta com categoria_id ainda NULL.
--      Conta cujo nome não casa com nenhuma categoria fica com categoria_id NULL e mantém o texto —
--      nenhuma categoria é criada. Se a empresa tiver duas categorias com o mesmo nome, vale a ATIVA
--      e, entre iguais, a mais antiga (escolha determinística).
--   Conta a pagar não tinha categoria: só ganha a coluna (nada a migrar).
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-12_categoria_financeira_por_id.sql

BEGIN;

-- 1. Colunas
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "categoria_id" TEXT;
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "categoria_id" TEXT;

-- 2. Chaves estrangeiras (mesmos nomes que o Prisma gera) e índices
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_categoria_id_fkey' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_categoria_id_fkey"
      FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_pagar_categoria_id_fkey' AND conrelid = '"contas_pagar"'::regclass) THEN
    ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_categoria_id_fkey"
      FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "contas_receber_categoria_id_idx" ON "contas_receber"("categoria_id");
CREATE INDEX IF NOT EXISTS "contas_pagar_categoria_id_idx" ON "contas_pagar"("categoria_id");

-- 3. Migração de dados: nome atual → id da categoria da mesma empresa (match exato)
UPDATE "contas_receber" AS cr
SET "categoria_id" = (
  SELECT cf."id"
  FROM "categorias_financeiras" AS cf
  WHERE cf."empresa_id" = cr."empresa_id" AND cf."nome" = cr."categoria"
  ORDER BY cf."ativo" DESC, cf."criado_em" ASC, cf."id" ASC
  LIMIT 1
)
WHERE cr."categoria_id" IS NULL
  AND cr."categoria" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "categorias_financeiras" AS cf
    WHERE cf."empresa_id" = cr."empresa_id" AND cf."nome" = cr."categoria"
  );

COMMIT;

-- Conferência (opcional, só leitura) — contas que continuam só com o texto antigo (sem categoria cadastrada):
--   SELECT "empresa_id", "categoria", COUNT(*) FROM "contas_receber"
--   WHERE "categoria" IS NOT NULL AND "categoria_id" IS NULL GROUP BY 1, 2 ORDER BY 3 DESC;
