-- Orçamento: desconto por grupo (Serviços / Produtos) e ISS sobre serviços.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Rodar ANTES do merge/deploy.

-- 1) Configurações da empresa: alíquota de ISS (%) — começa em 0 (nada muda até alguém configurar)
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "iss_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- 2) Orçamento: desconto de cada grupo (R$ ou %) + a alíquota congelada no orçamento e o valor do ISS
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "desconto_servicos" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "tipo_desconto_servicos" "TipoDesconto" NOT NULL DEFAULT 'VALOR';
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "desconto_produtos" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "tipo_desconto_produtos" "TipoDesconto" NOT NULL DEFAULT 'VALOR';
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "iss_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "valor_iss" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 3) Orçamentos antigos: o desconto GERAL vira desconto dos grupos, em R$, com a MESMA soma
--    (o total de cada orçamento não muda). Serviços primeiro (até o subtotal deles), o resto em
--    Produtos. Percentual: os serviços levam o mesmo % sobre eles, e os produtos o que faltar.
--    Só mexe em quem ainda não tem desconto por grupo — rodar de novo não muda nada.
WITH base AS (
  SELECT "id",
         "total_servicos" AS s,
         "total_produtos" AS p,
         CASE WHEN "tipo_desconto" = 'PERCENTUAL'
              THEN LEAST(ROUND(("total_servicos" + "total_produtos") * "desconto" / 100, 2), "total_servicos" + "total_produtos")
              ELSE LEAST("desconto", "total_servicos" + "total_produtos") END AS d,
         CASE WHEN "tipo_desconto" = 'PERCENTUAL'
              THEN LEAST(ROUND("total_servicos" * "desconto" / 100, 2), "total_servicos")
              ELSE "total_servicos" END AS teto_s
  FROM "orcamentos"
  WHERE "desconto" > 0 AND "desconto_servicos" = 0 AND "desconto_produtos" = 0
)
UPDATE "orcamentos" o
SET "desconto_servicos" = LEAST(base.d, base.teto_s),
    "tipo_desconto_servicos" = 'VALOR',
    "desconto_produtos" = base.d - LEAST(base.d, base.teto_s),
    "tipo_desconto_produtos" = 'VALOR'
FROM base
WHERE o."id" = base."id";
