-- Central de controle da OS (leva OS-A): prazo por atividade + status automático com ajuste manual.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Rodar ANTES do merge/deploy.

-- 1) Prazo próprio de cada atividade (dia civil, sem hora)
ALTER TABLE "atividades_os" ADD COLUMN IF NOT EXISTS "prazo" DATE;

-- 2) Ajuste manual do status da OS. O BACKFILL roda UMA vez só (no momento em que a coluna é
--    criada): OS antigas cujo status gravado está À FRENTE do que o automático calcularia ficam
--    marcadas como ajuste manual — o automático nunca rebaixa um status antigo sozinho:
--      • Pausada / Aguardando peça (exceções que só existem à mão);
--      • Concluída sem atividade, ou com atividade ainda aberta;
--      • Em andamento sem nenhuma atividade iniciada ou concluída;
--      • Agendada sem nenhuma atividade com data marcada (exceto OS sem atividade com data
--        prevista — a de contrato/recorrência —, que o automático também chama de Agendada).
--    O resto passa a ser automático (ex.: "Aberta" com atividade agendada vira "Agendada").
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ordens_servico' AND column_name = 'status_manual'
  ) THEN
    ALTER TABLE "ordens_servico" ADD COLUMN "status_manual" BOOLEAN NOT NULL DEFAULT false;

    UPDATE "ordens_servico" os SET "status_manual" = true
    WHERE os."status" IN ('PAUSADA', 'AGUARDANDO_PECA')
       OR (os."status" = 'CONCLUIDA' AND (
             NOT EXISTS (SELECT 1 FROM "atividades_os" a WHERE a."ordem_servico_id" = os."id" AND a."status" <> 'CANCELADA')
          OR EXISTS (SELECT 1 FROM "atividades_os" a WHERE a."ordem_servico_id" = os."id" AND a."status" IN ('AGENDADA', 'EM_ANDAMENTO'))))
       OR (os."status" = 'EM_ANDAMENTO' AND NOT EXISTS (
             SELECT 1 FROM "atividades_os" a WHERE a."ordem_servico_id" = os."id" AND a."status" IN ('EM_ANDAMENTO', 'CONCLUIDA')))
       OR (os."status" = 'AGENDADA' AND NOT EXISTS (
             SELECT 1 FROM "atividades_os" a WHERE a."ordem_servico_id" = os."id" AND a."status" <> 'CANCELADA' AND a."data_agendada" IS NOT NULL)
           AND NOT (os."previsao_conclusao" IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM "atividades_os" a WHERE a."ordem_servico_id" = os."id" AND a."status" <> 'CANCELADA')));
  END IF;
END $$;
