-- Leva 5.2 — cadastro de Fornecedor e ligação na conta a pagar.
-- Antes o fornecedor da conta a pagar era só texto livre ("fornecedor" + "fornecedor_cnpj").
-- Agora existe a tabela "fornecedores" e a conta aponta para ela por "fornecedor_id".
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. CREATE TABLE IF NOT EXISTS "fornecedores" (+ índices; documento único por empresa quando
--      preenchido — NULL não conflita no PostgreSQL);
--   2. ADD COLUMN IF NOT EXISTS "fornecedor_id" em contas_pagar, FK com ON DELETE SET NULL. Nada é
--      removido: o texto "fornecedor"/"fornecedor_cnpj" continua como histórico/fallback;
--   3. migração de dados:
--      a) cria UM fornecedor por nome distinto em cada empresa, a partir do texto das contas a pagar.
--         Nomes iguais ignorando maiúsculas e espaços (nas pontas e repetidos) são o mesmo fornecedor;
--         o nome gravado é a grafia mais usada (empate: a da conta mais antiga). O documento vem do "fornecedor_cnpj" das contas só
--         quando é único e válido (11 ou 14 dígitos) e ainda não pertence a outro fornecedor da empresa;
--         senão fica vazio. Texto vazio e o genérico "Fornecedor a definir" NÃO viram fornecedor.
--         Se já existe um fornecedor com o mesmo nome (normalizado) na empresa, não cria outro.
--      b) liga cada conta a pagar (só as que ainda não têm fornecedor_id) ao fornecedor DA MESMA
--         EMPRESA com o mesmo nome normalizado (ativo primeiro, depois o mais antigo). Conta que não
--         casa fica com fornecedor_id NULL e mantém o texto.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-13_fornecedores.sql

BEGIN;

-- 1. Tabela de fornecedores
CREATE TABLE IF NOT EXISTS "fornecedores" (
  "id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "documento" TEXT,
  "telefone" TEXT,
  "email" TEXT,
  "observacoes" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "fornecedores_empresa_id_ativo_idx" ON "fornecedores"("empresa_id", "ativo");
CREATE UNIQUE INDEX IF NOT EXISTS "fornecedores_empresa_id_documento_key" ON "fornecedores"("empresa_id", "documento");

-- 2. Coluna na conta a pagar + chaves estrangeiras (mesmos nomes que o Prisma gera)
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "fornecedor_id" TEXT;
CREATE INDEX IF NOT EXISTS "contas_pagar_fornecedor_id_idx" ON "contas_pagar"("fornecedor_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fornecedores_empresa_id_fkey' AND conrelid = '"fornecedores"'::regclass) THEN
    ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_pagar_fornecedor_id_fkey' AND conrelid = '"contas_pagar"'::regclass) THEN
    ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_fornecedor_id_fkey"
      FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3a. Um fornecedor por nome distinto (normalizado) em cada empresa, a partir das contas a pagar
WITH textos AS (
  SELECT
    cp."empresa_id",
    lower(btrim(regexp_replace(cp."fornecedor", '\s+', ' ', 'g'))) AS chave,
    btrim(regexp_replace(cp."fornecedor", '\s+', ' ', 'g')) AS nome,
    NULLIF(regexp_replace(COALESCE(cp."fornecedor_cnpj", ''), '\D', '', 'g'), '') AS doc,
    cp."criado_em"
  FROM "contas_pagar" AS cp
  WHERE cp."fornecedor_id" IS NULL
    AND btrim(regexp_replace(cp."fornecedor", '\s+', ' ', 'g')) <> ''
    AND lower(btrim(regexp_replace(cp."fornecedor", '\s+', ' ', 'g'))) <> 'fornecedor a definir'
),
-- Grafia de cada nome: a mais usada; empate = a da conta mais antiga
grafias AS (
  SELECT "empresa_id", chave, nome, COUNT(*) AS vezes, MIN("criado_em") AS primeira
  FROM textos GROUP BY "empresa_id", chave, nome
),
grupos AS (
  SELECT
    t."empresa_id", t.chave,
    (SELECT g.nome FROM grafias AS g WHERE g."empresa_id" = t."empresa_id" AND g.chave = t.chave
     ORDER BY g.vezes DESC, g.primeira ASC, g.nome ASC LIMIT 1) AS nome,
    CASE WHEN COUNT(DISTINCT t.doc) = 1 AND length(MIN(t.doc)) IN (11, 14) THEN MIN(t.doc) END AS doc
  FROM textos AS t
  GROUP BY t."empresa_id", t.chave
),
novos AS (
  SELECT g.*
  FROM grupos AS g
  WHERE NOT EXISTS (
    SELECT 1 FROM "fornecedores" AS f
    WHERE f."empresa_id" = g."empresa_id" AND lower(btrim(regexp_replace(f."nome", '\s+', ' ', 'g'))) = g.chave
  )
)
INSERT INTO "fornecedores" ("id", "empresa_id", "nome", "documento", "observacoes", "ativo", "criado_em", "atualizado_em")
SELECT
  'forn_' || md5(n."empresa_id" || '|' || n.chave),
  n."empresa_id",
  n.nome,
  -- Documento só se ninguém mais (novo ou já cadastrado) usa o mesmo na empresa
  CASE WHEN n.doc IS NOT NULL
        AND (SELECT COUNT(*) FROM novos AS o WHERE o."empresa_id" = n."empresa_id" AND o.doc = n.doc) = 1
        AND NOT EXISTS (SELECT 1 FROM "fornecedores" AS f WHERE f."empresa_id" = n."empresa_id" AND f."documento" = n.doc)
       THEN n.doc END,
  'Criado automaticamente a partir das contas a pagar (migração do texto livre).',
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM novos AS n
ON CONFLICT DO NOTHING;

-- 3b. Liga as contas ao fornecedor da mesma empresa com o mesmo nome normalizado
UPDATE "contas_pagar" AS cp
SET "fornecedor_id" = (
  SELECT f."id"
  FROM "fornecedores" AS f
  WHERE f."empresa_id" = cp."empresa_id"
    AND lower(btrim(regexp_replace(f."nome", '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(cp."fornecedor", '\s+', ' ', 'g')))
  ORDER BY f."ativo" DESC, f."criado_em" ASC, f."id" ASC
  LIMIT 1
)
WHERE cp."fornecedor_id" IS NULL
  AND lower(btrim(regexp_replace(cp."fornecedor", '\s+', ' ', 'g'))) NOT IN ('', 'fornecedor a definir')
  AND EXISTS (
    SELECT 1 FROM "fornecedores" AS f
    WHERE f."empresa_id" = cp."empresa_id"
      AND lower(btrim(regexp_replace(f."nome", '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(cp."fornecedor", '\s+', ' ', 'g')))
  );

COMMIT;

-- Conferência (opcional, só leitura) — contas a pagar que continuam só com o texto:
--   SELECT "empresa_id", "fornecedor", COUNT(*) FROM "contas_pagar"
--   WHERE "fornecedor_id" IS NULL GROUP BY 1, 2 ORDER BY 3 DESC;
