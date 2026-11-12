-- OS sem equipamento (leva pré-lançamento, parte B): saída da trava de equipamento na conclusão.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Rodar ANTES do merge/deploy.

-- 1) Tipo de OS: "exige equipamento para concluir". Padrão true = a trava continua valendo para
--    todos os tipos que já existem; o dono desmarca os de visita técnica, vistoria, orçamento...
ALTER TABLE "tipos_os" ADD COLUMN IF NOT EXISTS "exige_equipamento" BOOLEAN NOT NULL DEFAULT true;

-- 2) OS: motivo da conclusão sem equipamento (exceção pontual, justificada; quem/quando no histórico)
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "sem_equipamento_motivo" TEXT;
