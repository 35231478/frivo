-- ACEITE DO CLIENTE na conclusão da OS: a prova de que o cliente recebeu o serviço.
--
-- O que entra (tudo ADITIVO; nada é removido nem alterado):
--   1. "os_aceites": uma linha por OS, criada PENDENTE quando a OS conclui. Guarda quem aceitou (nome),
--      como (no local, com a assinatura desenhada; ou remoto, pelo link), o IP, o navegador e a
--      data/hora, o token do link público e o último envio do pedido ao cliente.
--   2. "configuracoes"."portal_aceite_obrigatorio": a opção por empresa do portal — com confirmações
--      pendentes, o cliente só abre chamado novo depois de confirmar (ou pela saída de emergência).
--      Nasce desligada (false): o padrão só mostra as pendências, sem bloquear.
--
-- O status da OS não muda: nenhuma coluna de "ordens_servico" é tocada e nenhum enum é criado
-- (situação, método e canal são TEXTO). As OS concluídas ANTES deste arquivo ficam sem linha em
-- "os_aceites": não viram pendência de ninguém.
--
-- IDEMPOTENTE: IF NOT EXISTS na tabela, na coluna e nos índices; as chaves estrangeiras só são criadas
-- quando ainda não existem. Pode rodar mais de uma vez. Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-28_os_aceite_cliente.sql

BEGIN;

ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "portal_aceite_obrigatorio" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "os_aceites" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "ordem_servico_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'PENDENTE',
    "metodo" TEXT,
    "nome" TEXT,
    "assinatura" TEXT,
    "observacao" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "confirmado_em" TIMESTAMP(3),
    "atividade_id" TEXT,
    "colhido_por_id" TEXT,
    "contato_id" TEXT,
    "enviado_em" TIMESTAMP(3),
    "enviado_canal" TEXT,
    "enviado_para" TEXT,
    "envios" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "os_aceites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "os_aceites_ordem_servico_id_key" ON "os_aceites"("ordem_servico_id");
CREATE UNIQUE INDEX IF NOT EXISTS "os_aceites_token_key" ON "os_aceites"("token");
CREATE INDEX IF NOT EXISTS "os_aceites_empresa_id_situacao_idx" ON "os_aceites"("empresa_id", "situacao");

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"os_aceites"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_aceites_ordem_servico_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "os_aceites" ADD CONSTRAINT "os_aceites_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_aceites_atividade_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "os_aceites" ADD CONSTRAINT "os_aceites_atividade_id_fkey"
      FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_aceites_colhido_por_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "os_aceites" ADD CONSTRAINT "os_aceites_colhido_por_id_fkey"
      FOREIGN KEY ("colhido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_aceites_contato_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "os_aceites" ADD CONSTRAINT "os_aceites_contato_id_fkey"
      FOREIGN KEY ("contato_id") REFERENCES "contatos_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
