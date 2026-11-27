-- App do técnico: FAIXA ESPERADA nas medições do checklist (leva app-campo 3, PR A).
--
--   1. "checklist_tipo_itens": "grandeza" (TEXT, opcional: o que a medição mede — SUCCAO, DESCARGA,
--      SUPERAQUECIMENTO, INSUFLAMENTO, RETORNO, DELTA_T…), "valor_min" e "valor_max" (DECIMAL(12,3), opcionais:
--      a faixa esperada, na unidade do item). Sem faixa, nada muda.
--   2. "checklist_respostas": "faixa_min" e "faixa_max" (a faixa no momento da resposta, na unidade da resposta:
--      o relatório antigo continua fiel) e "fora_da_faixa" (BOOLEAN NOT NULL DEFAULT false), com um índice para o
--      painel do gestor (empresa, fora da faixa, quando).
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): SEIS colunas novas e UM
-- índice novo, nos nomes que o Prisma gera. Nada existente é removido nem alterado; nenhuma faixa é gravada por
-- este SQL (a empresa aplica as sugeridas na tela do tipo de equipamento).
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-05_checklist_faixas.sql

BEGIN;

ALTER TABLE "checklist_tipo_itens" ADD COLUMN IF NOT EXISTS "grandeza" TEXT;
ALTER TABLE "checklist_tipo_itens" ADD COLUMN IF NOT EXISTS "valor_min" DECIMAL(12,3);
ALTER TABLE "checklist_tipo_itens" ADD COLUMN IF NOT EXISTS "valor_max" DECIMAL(12,3);

ALTER TABLE "checklist_respostas" ADD COLUMN IF NOT EXISTS "faixa_min" DECIMAL(12,3);
ALTER TABLE "checklist_respostas" ADD COLUMN IF NOT EXISTS "faixa_max" DECIMAL(12,3);
ALTER TABLE "checklist_respostas" ADD COLUMN IF NOT EXISTS "fora_da_faixa" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "checklist_respostas_empresa_id_fora_da_faixa_respondido_em_idx"
  ON "checklist_respostas"("empresa_id", "fora_da_faixa", "respondido_em");

COMMIT;
