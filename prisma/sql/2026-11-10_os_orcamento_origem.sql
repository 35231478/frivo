-- Faturamento avulso — "Gerar OS" a partir do orçamento aprovado: a OS guarda o orçamento que a GEROU.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado. Sem backfill (as OS já
-- vinculadas a orçamentos continuam ligadas pela tabela orcamento_ordens_servico, como antes).
--  - ÚNICO: um orçamento gera no máximo uma OS (o 2º clique, mesmo simultâneo, não duplica);
--  - apagar o orçamento não apaga a OS (a referência vira nula).

ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "orcamento_origem_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ordens_servico_orcamento_origem_id_key" ON "ordens_servico" ("orcamento_origem_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ordens_servico_orcamento_origem_id_fkey' AND conrelid = '"ordens_servico"'::regclass) THEN
    ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_orcamento_origem_id_fkey"
      FOREIGN KEY ("orcamento_origem_id") REFERENCES "orcamentos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
