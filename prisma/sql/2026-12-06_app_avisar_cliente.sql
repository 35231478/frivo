-- App do técnico: avisar o cliente quando o técnico está "A caminho" e quando "Chegou".
--
--   1. "configuracoes"."app_avisar_cliente": a permissão "Avisar o cliente (a caminho / cheguei)"
--      (Equipes › App do colaborador), por empresa. NOT NULL com DEFAULT true — o padrão combinado com
--      o produto: as empresas já cadastradas começam com o aviso LIGADO. Desligado, os botões nem
--      aparecem no app e nenhum aviso sai.
--   2. "atividade_avisos" (tabela nova): o horário de cada toque ("A caminho" / "Cheguei") e o que
--      aconteceu com o aviso ao cliente (enviado, sem sinal na hora, cliente sem e-mail…). A chave
--      única (atividade, evento, dia) é o que impede dois avisos pelo mesmo toque repetido.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): UMA coluna nova
-- e UMA tabela nova, com os índices e a chave estrangeira nos nomes que o Prisma gera. Nada existente
-- é removido nem alterado.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-06_app_avisar_cliente.sql

BEGIN;

ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_avisar_cliente" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "atividade_avisos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "atividade_id" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "registrado_em" TIMESTAMP(3) NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "aviso_status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "aviso_detalhe" TEXT,
    "aviso_para" TEXT,
    "aviso_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "atividade_avisos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "atividade_avisos_empresa_id_idx" ON "atividade_avisos"("empresa_id");
CREATE UNIQUE INDEX IF NOT EXISTS "atividade_avisos_atividade_id_evento_dia_key" ON "atividade_avisos"("atividade_id", "evento", "dia");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_avisos_atividade_id_fkey' AND conrelid = to_regclass('"atividade_avisos"')
  ) THEN
    ALTER TABLE "atividade_avisos" ADD CONSTRAINT "atividade_avisos_atividade_id_fkey"
      FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
