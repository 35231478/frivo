-- App do técnico: MATERIAIS USADOS EM CAMPO (leva app-campo 1).
--
--   "atividade_materiais" (tabela nova): o material que o técnico usou na OS, por atividade e (opcional) por
--   equipamento, gravado no app com ou sem sinal. "client_id" é gerado no aparelho: a mesma gravação reenviada
--   não duplica (chave única empresa + client_id). A baixa do estoque continua no razão de sempre
--   (movimentacoes_estoque, SAIDA de origem OS, com o veículo em "local_id", coluna que já existia); esta
--   tabela guarda o uso, de onde saiu, a separação da OS que ele consumiu e quanto foi baixado direto, e quem
--   corrigiu ou estornou (nada é apagado).
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): UMA tabela nova, com os
-- índices e as chaves estrangeiras nos nomes que o Prisma gera. Nada existente é removido nem alterado.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-01_app_materiais_campo.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "atividade_materiais" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "ordem_servico_id" TEXT NOT NULL,
    "atividade_id" TEXT NOT NULL,
    "equipamento_id" TEXT,
    "produto_id" TEXT,
    "descricao" TEXT NOT NULL,
    "unidade" TEXT NOT NULL DEFAULT 'un',
    "quantidade" DECIMAL(12,3) NOT NULL,
    "client_id" TEXT NOT NULL,
    "veiculo_id" TEXT,
    "os_material_id" TEXT,
    "baixado" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "corrigido_por_id" TEXT,
    "corrigido_em" TIMESTAMP(3),
    "removido_por_id" TEXT,
    "removido_em" TIMESTAMP(3),
    CONSTRAINT "atividade_materiais_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "atividade_materiais_atividade_id_idx" ON "atividade_materiais"("atividade_id");
CREATE INDEX IF NOT EXISTS "atividade_materiais_ordem_servico_id_idx" ON "atividade_materiais"("ordem_servico_id");
CREATE INDEX IF NOT EXISTS "atividade_materiais_produto_id_idx" ON "atividade_materiais"("produto_id");
CREATE INDEX IF NOT EXISTS "atividade_materiais_os_material_id_idx" ON "atividade_materiais"("os_material_id");
CREATE UNIQUE INDEX IF NOT EXISTS "atividade_materiais_empresa_id_client_id_key" ON "atividade_materiais"("empresa_id", "client_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_materiais_ordem_servico_id_fkey' AND conrelid = to_regclass('"atividade_materiais"')
  ) THEN
    ALTER TABLE "atividade_materiais" ADD CONSTRAINT "atividade_materiais_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_materiais_atividade_id_fkey' AND conrelid = to_regclass('"atividade_materiais"')
  ) THEN
    ALTER TABLE "atividade_materiais" ADD CONSTRAINT "atividade_materiais_atividade_id_fkey"
      FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_materiais_equipamento_id_fkey' AND conrelid = to_regclass('"atividade_materiais"')
  ) THEN
    ALTER TABLE "atividade_materiais" ADD CONSTRAINT "atividade_materiais_equipamento_id_fkey"
      FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_materiais_produto_id_fkey' AND conrelid = to_regclass('"atividade_materiais"')
  ) THEN
    ALTER TABLE "atividade_materiais" ADD CONSTRAINT "atividade_materiais_produto_id_fkey"
      FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_materiais_os_material_id_fkey' AND conrelid = to_regclass('"atividade_materiais"')
  ) THEN
    ALTER TABLE "atividade_materiais" ADD CONSTRAINT "atividade_materiais_os_material_id_fkey"
      FOREIGN KEY ("os_material_id") REFERENCES "os_materiais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
