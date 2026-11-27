-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- "Orçamento E2 — regra de materiais por empresa" (aditivo e idempotente: pode rodar mais de uma vez sem mudar nada)
--
-- Cada empresa escolhe como os MATERIAIS entram na cobrança (a Peça vai sempre à parte):
--   INCLUSO  = dentro do serviço, sem valor para o cliente (o jeito de hoje; padrão de toda empresa, a Termofrio inclusa);
--   A_PARTE  = em linha própria com o preço de venda, somando no total, como a peça.
--
-- 1. configuracoes.orcamento_cobranca_materiais — a regra da empresa (padrão INCLUSO).
-- 2. orcamentos.cobranca_materiais — a regra com que o orçamento NASCEU (os que já existem ficam INCLUSO, como eram;
--    mudar a configuração depois não altera orçamento antigo nem aprovado).
-- 3. ordens_servico.cobranca_materiais — a regra da OS (copiada do orçamento ao gerar; na OS sem orçamento, fixada no
--    1º salvamento de um item com materiais). Nula = ainda não fixada. As OS que JÁ têm materiais ficam INCLUSO
--    (é como os valores delas foram calculados).
-- Nada é apagado; orcamento_mostrar_valores_materiais não é reaproveitada.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- O tipo
DO $$ BEGIN
  CREATE TYPE "CobrancaMateriais" AS ENUM ('INCLUSO', 'A_PARTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. A regra da empresa
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "orcamento_cobranca_materiais" "CobrancaMateriais" NOT NULL DEFAULT 'INCLUSO';

-- 2. A regra de cada orçamento (os existentes: INCLUSO)
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "cobranca_materiais" "CobrancaMateriais" NOT NULL DEFAULT 'INCLUSO';

-- 3. A regra de cada OS (nula até ser fixada)
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "cobranca_materiais" "CobrancaMateriais";

-- 3a. OS que já têm materiais: a regra com que foram calculadas (INCLUSO). Só onde ainda está nula.
UPDATE "ordens_servico" os SET "cobranca_materiais" = 'INCLUSO'
WHERE os."cobranca_materiais" IS NULL
  AND EXISTS (SELECT 1 FROM "os_materiais" m WHERE m."ordem_servico_id" = os."id");
