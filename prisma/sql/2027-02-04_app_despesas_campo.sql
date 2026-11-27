-- App do técnico: DESPESAS DE CAMPO com foto do cupom (leva app-campo 2, PR B).
--
--   1. "configuracoes"."app_lancar_despesas" (BOOLEAN NOT NULL DEFAULT true): a permissão "Lançar despesas pelo app"
--      (Equipes › App do colaborador). As empresas já cadastradas começam com ela LIGADA.
--   2. "configuracoes"."despesas_campo_categorias" (JSONB, opcional): a categoria financeira de cada categoria fixa da
--      despesa (Financeiro › Despesas de campo › Categorias). Vazio = a categoria financeira de mesmo nome.
--   3. "despesas_campo" (tabela nova): a despesa lançada no app (categoria, valor, dia, como foi paga, OS), a decisão do
--      escritório (aprovada/recusada com o motivo, quem e quando) e a conta a pagar de reembolso que a aprovação gerou.
--      "client_id" (gerado no aparelho) faz a despesa reenviada não duplicar.
--   4. "despesas_campo_fotos" (tabela nova): a foto do cupom, 1-1, à parte (a lista nunca arrasta a imagem).
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): DUAS colunas novas e DUAS
-- tabelas novas, com os índices e as chaves estrangeiras nos nomes que o Prisma gera. Nada existente é removido nem
-- alterado.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-04_app_despesas_campo.sql

BEGIN;

ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_lancar_despesas" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "despesas_campo_categorias" JSONB;

CREATE TABLE IF NOT EXISTS "despesas_campo" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tecnico_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "ordem_servico_id" TEXT,
    "atividade_id" TEXT,
    "categoria" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "data" DATE NOT NULL,
    "descricao" TEXT,
    "pagamento" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "motivo_recusa" TEXT,
    "decidido_por_id" TEXT,
    "decidido_em" TIMESTAMP(3),
    "conta_pagar_id" TEXT,
    "client_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "despesas_campo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "despesas_campo_fotos" (
    "despesa_id" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    CONSTRAINT "despesas_campo_fotos_pkey" PRIMARY KEY ("despesa_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "despesas_campo_conta_pagar_id_key" ON "despesas_campo"("conta_pagar_id");
CREATE INDEX IF NOT EXISTS "despesas_campo_empresa_id_status_data_idx" ON "despesas_campo"("empresa_id", "status", "data");
CREATE INDEX IF NOT EXISTS "despesas_campo_tecnico_id_idx" ON "despesas_campo"("tecnico_id");
CREATE INDEX IF NOT EXISTS "despesas_campo_ordem_servico_id_idx" ON "despesas_campo"("ordem_servico_id");
CREATE UNIQUE INDEX IF NOT EXISTS "despesas_campo_empresa_id_client_id_key" ON "despesas_campo"("empresa_id", "client_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'despesas_campo_tecnico_id_fkey' AND conrelid = to_regclass('"despesas_campo"')
  ) THEN
    ALTER TABLE "despesas_campo" ADD CONSTRAINT "despesas_campo_tecnico_id_fkey"
      FOREIGN KEY ("tecnico_id") REFERENCES "tecnicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'despesas_campo_ordem_servico_id_fkey' AND conrelid = to_regclass('"despesas_campo"')
  ) THEN
    ALTER TABLE "despesas_campo" ADD CONSTRAINT "despesas_campo_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'despesas_campo_atividade_id_fkey' AND conrelid = to_regclass('"despesas_campo"')
  ) THEN
    ALTER TABLE "despesas_campo" ADD CONSTRAINT "despesas_campo_atividade_id_fkey"
      FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'despesas_campo_conta_pagar_id_fkey' AND conrelid = to_regclass('"despesas_campo"')
  ) THEN
    ALTER TABLE "despesas_campo" ADD CONSTRAINT "despesas_campo_conta_pagar_id_fkey"
      FOREIGN KEY ("conta_pagar_id") REFERENCES "contas_pagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'despesas_campo_fotos_despesa_id_fkey' AND conrelid = to_regclass('"despesas_campo_fotos"')
  ) THEN
    ALTER TABLE "despesas_campo_fotos" ADD CONSTRAINT "despesas_campo_fotos_despesa_id_fkey"
      FOREIGN KEY ("despesa_id") REFERENCES "despesas_campo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
