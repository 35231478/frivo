-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- CHAT-1 — chat interno estilo WhatsApp sobre os comentários da OS. Aditivo e idempotente: pode rodar mais de uma vez
-- sem mudar nada.
--
--  - os_comentarios: quando a mensagem foi lida pela 1ª vez por alguém que não o autor, e por quem (o ✓✓); dois
--    índices para a lista de conversas e para o "tem novidade?" do tempo real;
--  - os_comentarios_fotos: a foto de uma mensagem (data URL, como os anexos da OS, com a miniatura feita no aparelho).
--    Tabela própria: a conversa é interna e a foto nunca entra na galeria, no relatório nem no portal do cliente.
--
-- Nenhuma linha que já existe muda (as colunas novas nascem nulas). Nada é apagado. Nenhum perfil de acesso é alterado.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "os_comentarios" ADD COLUMN IF NOT EXISTS "lida_em" TIMESTAMP(3);
ALTER TABLE "os_comentarios" ADD COLUMN IF NOT EXISTS "lida_por_id" TEXT;
CREATE INDEX IF NOT EXISTS "os_comentarios_empresa_id_criado_em_idx" ON "os_comentarios"("empresa_id", "criado_em");
CREATE INDEX IF NOT EXISTS "os_comentarios_empresa_id_lida_em_idx" ON "os_comentarios"("empresa_id", "lida_em");

CREATE TABLE IF NOT EXISTS "os_comentarios_fotos" (
    "id" TEXT NOT NULL,
    "comentario_id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "conteudo" TEXT NOT NULL,
    "miniatura" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "os_comentarios_fotos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "os_comentarios_fotos_comentario_id_key" ON "os_comentarios_fotos"("comentario_id");
DO $$ BEGIN
  ALTER TABLE "os_comentarios_fotos" ADD CONSTRAINT "os_comentarios_fotos_comentario_id_fkey" FOREIGN KEY ("comentario_id") REFERENCES "os_comentarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
