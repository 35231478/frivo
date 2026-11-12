-- Códigos de produto e de serviço (chave da planilha exportada e atalho de busca).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado; só preenche o que está vazio.
--
-- Produto: código NUMÉRICO sequencial por empresa (1, 2, 3…). Backfill na ordem de cadastro,
--          continuando do maior código que a empresa já tiver.
-- Serviço: código ALFANUMÉRICO = 4 primeiras letras do nome (sem acento, maiúsculas; sem letras = "SRV")
--          + sequencial de 2 dígitos por prefixo (LIMP01, LIMP02…), continuando do maior já usado.
--          Editável depois na tela. É a MESMA regra do sistema (lib/cadastros/codigos.ts).

-- 1) Colunas
ALTER TABLE "produtos" ADD COLUMN IF NOT EXISTS "codigo" INTEGER;
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "codigo" TEXT;

-- 2) Backfill dos produtos sem código
WITH base AS (
  SELECT "empresa_id", COALESCE(MAX("codigo"), 0) AS maior FROM "produtos" GROUP BY "empresa_id"
), novos AS (
  SELECT p."id", b.maior + ROW_NUMBER() OVER (PARTITION BY p."empresa_id" ORDER BY p."criado_em", p."id") AS codigo
  FROM "produtos" p JOIN base b ON b."empresa_id" = p."empresa_id"
  WHERE p."codigo" IS NULL
)
UPDATE "produtos" p SET "codigo" = novos.codigo FROM novos WHERE p."id" = novos."id";

-- 3) Backfill dos serviços sem código
WITH semCodigo AS (
  SELECT s."id", s."empresa_id", s."criado_em",
    COALESCE(NULLIF(LEFT(regexp_replace(upper(translate(s."nome",
      'áàâãäåéèêëíìîïóòôõöúùûüçñýÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ',
      'aaaaaaeeeeiiiiooooouuuucnyAAAAAAEEEEIIIIOOOOOUUUUCNY')), '[^A-Z]', '', 'g'), 4), ''), 'SRV') AS prefixo
  FROM "servicos" s
  WHERE s."codigo" IS NULL
), usados AS (
  SELECT "empresa_id", substring("codigo" FROM '^[A-Z]+') AS prefixo,
    MAX(CAST(substring("codigo" FROM '[0-9]+$') AS INTEGER)) AS maior
  FROM "servicos"
  WHERE "codigo" ~ '^[A-Z]+[0-9]{1,6}$'
  GROUP BY 1, 2
), novos AS (
  SELECT sc."id",
    COALESCE(u.maior, 0) + ROW_NUMBER() OVER (PARTITION BY sc."empresa_id", sc.prefixo ORDER BY sc."criado_em", sc."id") AS n,
    sc.prefixo
  FROM semCodigo sc
  LEFT JOIN usados u ON u."empresa_id" = sc."empresa_id" AND u.prefixo = sc.prefixo
)
UPDATE "servicos" s
SET "codigo" = novos.prefixo || CASE WHEN novos.n < 100 THEN lpad(novos.n::text, 2, '0') ELSE novos.n::text END
FROM novos WHERE s."id" = novos."id";

-- 4) Únicos por empresa (vazio não conta: o sistema sempre preenche ao criar)
CREATE UNIQUE INDEX IF NOT EXISTS "produtos_empresa_id_codigo_key" ON "produtos"("empresa_id", "codigo");
CREATE UNIQUE INDEX IF NOT EXISTS "servicos_empresa_id_codigo_key" ON "servicos"("empresa_id", "codigo");
