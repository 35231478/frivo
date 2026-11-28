-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- HOTFIX push — o resultado de cada envio, por aparelho. Aditivo e idempotente: pode rodar mais de uma vez.
--
-- Até aqui push_envios só guardava quantos aparelhos ACEITARAM; a recusa do serviço de push (403 de chave VAPID que
-- não confere, 400, 5xx) não ficava em lugar nenhum. Agora:
--  - push_envios.falhas e push_envios.resultados (o status e o motivo de cada aparelho);
--  - push_subscriptions: o último status, o último erro e a IMPRESSÃO da chave pública com que o navegador se
--    inscreveu (sha-256, 12 caracteres — nunca a chave).
-- Nada é apagado nem atualizado.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "push_envios" ADD COLUMN IF NOT EXISTS "falhas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "push_envios" ADD COLUMN IF NOT EXISTS "resultados" JSONB;

ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "chave_impressao" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "ultimo_status" INTEGER;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "ultimo_erro" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "ultimo_erro_em" TIMESTAMP(3);
