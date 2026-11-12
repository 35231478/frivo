-- NFS-e PR3 (B) — aviso automático (webhook) do PlugNotas por empresa + aviso de nota no sino.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado; SEM enum novo.
-- O segredo do webhook NÃO é guardado: só o hash SHA-256 dele (a URL com o segredo aparece uma vez
-- na tela, quando é gerada). O token do PlugNotas continua só no ambiente do servidor.

-- 1) Webhook da empresa (Dados fiscais)
ALTER TABLE "empresa_fiscal" ADD COLUMN IF NOT EXISTS "webhook_token_hash" VARCHAR(64);
ALTER TABLE "empresa_fiscal" ADD COLUMN IF NOT EXISTS "webhook_gerado_em" TIMESTAMP(3);
ALTER TABLE "empresa_fiscal" ADD COLUMN IF NOT EXISTS "webhook_ambiente" TEXT;
ALTER TABLE "empresa_fiscal" ADD COLUMN IF NOT EXISTS "webhook_registrado_em" TIMESTAMP(3);
ALTER TABLE "empresa_fiscal" ADD COLUMN IF NOT EXISTS "webhook_erro" TEXT;
ALTER TABLE "empresa_fiscal" ADD COLUMN IF NOT EXISTS "webhook_recebido_em" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "empresa_fiscal_webhook_token_hash_key" ON "empresa_fiscal"("webhook_token_hash");

-- 2) Nota: quando o resultado (autorizada/rejeitada) foi visto — o sino avisa enquanto for NULL.
--    As notas que JÁ terminaram antes deste SQL entram como vistas (só na 1ª vez: a coluna nova).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'notas_fiscais' AND column_name = 'aviso_visto_em') THEN
    ALTER TABLE "notas_fiscais" ADD COLUMN IF NOT EXISTS "aviso_visto_em" TIMESTAMP(3);
    UPDATE "notas_fiscais" SET "aviso_visto_em" = "atualizado_em"
     WHERE "status" IN ('CONCLUIDO', 'REJEITADO', 'CANCELADO', 'INTERROMPIDO');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "notas_fiscais_empresa_id_aviso_visto_em_idx" ON "notas_fiscais"("empresa_id", "aviso_visto_em");
