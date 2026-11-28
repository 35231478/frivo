-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- CHAT-1.1 — sobre o CHAT-1 (2027-02-20_chat_1.sql, já aplicado). Aditivo e idempotente: pode rodar mais de uma vez
-- sem mudar nada.
--
--  - RESPONDER uma mensagem (a citação, como no WhatsApp): a mensagem que esta responde (vazio = nenhuma);
--  - a FOTO do chat VINCULADA ao equipamento: o equipamento da foto, como o vínculo nasceu (a OS tem um só, a
--    atividade em andamento, o QR code na foto, a escolha de quem enviou ou a correção), o equipamento que um QR de
--    OUTRO cliente sugere (sem vincular) e se o escritório pôs a foto no relatório da atividade (por referência).
--
-- Nenhuma linha que já existe muda (as colunas novas nascem nulas, e "no_relatorio" falso). Nada é apagado. Nenhum
-- perfil de acesso é alterado. Mensagem nunca se edita nem se apaga: o vínculo da foto é um dado ao lado dela, e cada
-- correção fica no histórico da OS.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- Responder: a citada (nada se apaga no chat; SET NULL só por segurança)
ALTER TABLE "os_comentarios" ADD COLUMN IF NOT EXISTS "resposta_a_id" TEXT;
DO $$ BEGIN
  ALTER TABLE "os_comentarios" ADD CONSTRAINT "os_comentarios_resposta_a_id_fkey" FOREIGN KEY ("resposta_a_id") REFERENCES "os_comentarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A foto e o equipamento
ALTER TABLE "os_comentarios_fotos" ADD COLUMN IF NOT EXISTS "equipamento_id" TEXT;
ALTER TABLE "os_comentarios_fotos" ADD COLUMN IF NOT EXISTS "equipamento_origem" TEXT;
ALTER TABLE "os_comentarios_fotos" ADD COLUMN IF NOT EXISTS "equipamento_sugerido_id" TEXT;
ALTER TABLE "os_comentarios_fotos" ADD COLUMN IF NOT EXISTS "no_relatorio" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "os_comentarios_fotos_empresa_id_equipamento_id_idx" ON "os_comentarios_fotos"("empresa_id", "equipamento_id");
DO $$ BEGIN
  ALTER TABLE "os_comentarios_fotos" ADD CONSTRAINT "os_comentarios_fotos_equipamento_id_fkey" FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "os_comentarios_fotos" ADD CONSTRAINT "os_comentarios_fotos_equipamento_sugerido_id_fkey" FOREIGN KEY ("equipamento_sugerido_id") REFERENCES "equipamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
