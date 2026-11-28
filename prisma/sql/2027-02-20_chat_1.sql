-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- CHAT-1 — chat interno estilo WhatsApp sobre os comentários da OS. Aditivo e idempotente: pode rodar mais de uma vez
-- sem mudar nada.
--
--  - os_comentarios: quando a mensagem foi lida pela 1ª vez por alguém que não o autor, e por quem (o ✓✓); dois
--    índices para a lista de conversas e para o "tem novidade?" do tempo real;
--  - os_comentarios_fotos: a foto de uma mensagem (data URL, como os anexos da OS, com a miniatura feita no aparelho).
--    Tabela própria: a conversa é interna e a foto nunca entra na galeria, no relatório nem no portal do cliente.
--
--  - conversa POR PESSOA (o desenho aprovado): a mensagem pode não ter OS ("passa no escritório antes de ir embora") —
--    a coluna da OS passa a aceitar vazio (só RELAXA a regra; nenhuma linha muda) —, o destinatário da mensagem do
--    escritório (vazio = todos os técnicos da OS, como era) e até quando cada pessoa leu a conversa de cada técnico.
--
-- Nenhuma linha que já existe muda (as colunas novas nascem nulas). Nada é apagado. Nenhum perfil de acesso é alterado
-- (a permissão nova "Conversas" o administrador liga nos perfis, na tela — ver docs/chat-1.md).
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

-- Conversa por pessoa: OS opcional, destinatário e a leitura da conversa
ALTER TABLE "os_comentarios" ALTER COLUMN "ordem_servico_id" DROP NOT NULL;
ALTER TABLE "os_comentarios" ADD COLUMN IF NOT EXISTS "para_usuario_id" TEXT;
CREATE INDEX IF NOT EXISTS "os_comentarios_empresa_id_para_usuario_id_criado_em_idx" ON "os_comentarios"("empresa_id", "para_usuario_id", "criado_em");
CREATE INDEX IF NOT EXISTS "os_comentarios_empresa_id_usuario_id_criado_em_idx" ON "os_comentarios"("empresa_id", "usuario_id", "criado_em");

CREATE TABLE IF NOT EXISTS "conversas_leituras" (
    "usuario_id" TEXT NOT NULL,
    "conversa_usuario_id" TEXT NOT NULL,
    "lido_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversas_leituras_pkey" PRIMARY KEY ("usuario_id", "conversa_usuario_id")
);
CREATE INDEX IF NOT EXISTS "conversas_leituras_conversa_usuario_id_idx" ON "conversas_leituras"("conversa_usuario_id");
