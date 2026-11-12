-- PMOC — OCORRÊNCIAS: o registro das não conformidades achadas na manutenção dos equipamentos do plano.
--
-- O que entra (tudo ADITIVO; nada é removido nem alterado):
--   1. "pmoc_ocorrencias": uma linha por ocorrência do plano — data, equipamento (opcional), descrição,
--      gravidade, situação, resolução e a foto/anexo.
--      Já nasce com os vínculos OPCIONAIS que as próximas etapas vão usar, todos vazios por ora:
--        "ordem_servico_id" / "atividade_id"  → a OS e a visita onde foi detectada;
--        "checklist_resposta_id" (único)       → a "Atenção" do técnico que a originou;
--        "orcamento_id" / "os_corretiva_id"    → o orçamento ou a OS corretiva gerados a partir dela.
--
-- Gravidade, situação e origem são TEXTO ('BAIXA'…'CRITICA'; 'ABERTA' | 'EM_ANDAMENTO' | 'RESOLVIDA';
-- 'MANUAL' | 'APP'): não cria enum, por isso é um arquivo só.
--
-- IDEMPOTENTE: IF NOT EXISTS na tabela e nos índices; as chaves estrangeiras só são criadas quando
-- ainda não existem. Pode rodar mais de uma vez. Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-22_pmoc_ocorrencias.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "pmoc_ocorrencias" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "pmoc_id" TEXT NOT NULL,
    "equipamento_id" TEXT,
    "data" DATE NOT NULL,
    "descricao" TEXT NOT NULL,
    "gravidade" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'ABERTA',
    "resolvida_em" DATE,
    "resolucao" TEXT,
    "resolvida_por_id" TEXT,
    "anexo" TEXT,
    "anexo_nome" TEXT,
    "anexo_tipo" TEXT,
    "anexo_tamanho" INTEGER,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "ordem_servico_id" TEXT,
    "atividade_id" TEXT,
    "checklist_resposta_id" TEXT,
    "orcamento_id" TEXT,
    "os_corretiva_id" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pmoc_ocorrencias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pmoc_ocorrencias_checklist_resposta_id_key" ON "pmoc_ocorrencias"("checklist_resposta_id");
CREATE INDEX IF NOT EXISTS "pmoc_ocorrencias_pmoc_id_data_idx" ON "pmoc_ocorrencias"("pmoc_id", "data");
CREATE INDEX IF NOT EXISTS "pmoc_ocorrencias_empresa_id_idx" ON "pmoc_ocorrencias"("empresa_id");
CREATE INDEX IF NOT EXISTS "pmoc_ocorrencias_equipamento_id_idx" ON "pmoc_ocorrencias"("equipamento_id");
CREATE INDEX IF NOT EXISTS "pmoc_ocorrencias_ordem_servico_id_idx" ON "pmoc_ocorrencias"("ordem_servico_id");

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"pmoc_ocorrencias"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_ocorrencias_pmoc_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "pmoc_ocorrencias" ADD CONSTRAINT "pmoc_ocorrencias_pmoc_id_fkey"
      FOREIGN KEY ("pmoc_id") REFERENCES "pmocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_ocorrencias_equipamento_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "pmoc_ocorrencias" ADD CONSTRAINT "pmoc_ocorrencias_equipamento_id_fkey"
      FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_ocorrencias_ordem_servico_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "pmoc_ocorrencias" ADD CONSTRAINT "pmoc_ocorrencias_ordem_servico_id_fkey"
      FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_ocorrencias_atividade_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "pmoc_ocorrencias" ADD CONSTRAINT "pmoc_ocorrencias_atividade_id_fkey"
      FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_ocorrencias_checklist_resposta_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "pmoc_ocorrencias" ADD CONSTRAINT "pmoc_ocorrencias_checklist_resposta_id_fkey"
      FOREIGN KEY ("checklist_resposta_id") REFERENCES "checklist_respostas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_ocorrencias_orcamento_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "pmoc_ocorrencias" ADD CONSTRAINT "pmoc_ocorrencias_orcamento_id_fkey"
      FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_ocorrencias_os_corretiva_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "pmoc_ocorrencias" ADD CONSTRAINT "pmoc_ocorrencias_os_corretiva_id_fkey"
      FOREIGN KEY ("os_corretiva_id") REFERENCES "ordens_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
