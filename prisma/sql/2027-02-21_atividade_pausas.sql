-- App do técnico: PAUSAR / IMPEDIMENTO na atividade (leva "App pronto pra janeiro 2", PR A).
--
--   1. "TipoMotivoPausa" (enum novo): IMPEDIMENTO (avisa o escritório e permite encerrar a visita como "Não concluída —
--      precisa voltar") ou INTERVALO (almoço: só para o relógio).
--   2. "motivos_pausa" (tabela nova): os motivos de cada empresa (Configurações › Motivos de pausa: criar, editar,
--      inativar). Os padrões nascem na 1ª vez que a empresa usa (pelo sistema), não por este SQL.
--   3. "atividade_pausas" (tabela nova): cada pausa (início e fim, no relógio do aparelho). A aberta (fim nulo) deixa a
--      atividade "Pausada"; o tempo entre início e fim não conta como execução. "client_id" (gerado no aparelho) faz a
--      pausa reenviada sem sinal não duplicar.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): um tipo e duas tabelas novos,
-- com os índices e as chaves estrangeiras nos nomes que o Prisma gera. Nada existente é removido nem alterado.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-21_atividade_pausas.sql

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'TipoMotivoPausa' AND n.nspname = current_schema()) THEN
    CREATE TYPE "TipoMotivoPausa" AS ENUM ('IMPEDIMENTO', 'INTERVALO');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "motivos_pausa" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoMotivoPausa" NOT NULL DEFAULT 'IMPEDIMENTO',
    "pede_texto" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "motivos_pausa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "atividade_pausas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "atividade_id" TEXT NOT NULL,
    "motivo_id" TEXT,
    "motivo" TEXT NOT NULL,
    "impedimento" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "nao_concluida" BOOLEAN NOT NULL DEFAULT false,
    "pausado_por_id" TEXT,
    "retomado_por_id" TEXT,
    "client_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "atividade_pausas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "motivos_pausa_empresa_id_nome_key" ON "motivos_pausa"("empresa_id", "nome");
CREATE UNIQUE INDEX IF NOT EXISTS "atividade_pausas_client_id_key" ON "atividade_pausas"("client_id");
CREATE INDEX IF NOT EXISTS "atividade_pausas_atividade_id_inicio_idx" ON "atividade_pausas"("atividade_id", "inicio");
CREATE INDEX IF NOT EXISTS "atividade_pausas_empresa_id_fim_idx" ON "atividade_pausas"("empresa_id", "fim");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'motivos_pausa_empresa_id_fkey' AND conrelid = to_regclass('"motivos_pausa"')
  ) THEN
    ALTER TABLE "motivos_pausa" ADD CONSTRAINT "motivos_pausa_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_pausas_empresa_id_fkey' AND conrelid = to_regclass('"atividade_pausas"')
  ) THEN
    ALTER TABLE "atividade_pausas" ADD CONSTRAINT "atividade_pausas_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_pausas_atividade_id_fkey' AND conrelid = to_regclass('"atividade_pausas"')
  ) THEN
    ALTER TABLE "atividade_pausas" ADD CONSTRAINT "atividade_pausas_atividade_id_fkey"
      FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_pausas_motivo_id_fkey' AND conrelid = to_regclass('"atividade_pausas"')
  ) THEN
    ALTER TABLE "atividade_pausas" ADD CONSTRAINT "atividade_pausas_motivo_id_fkey"
      FOREIGN KEY ("motivo_id") REFERENCES "motivos_pausa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_pausas_pausado_por_id_fkey' AND conrelid = to_regclass('"atividade_pausas"')
  ) THEN
    ALTER TABLE "atividade_pausas" ADD CONSTRAINT "atividade_pausas_pausado_por_id_fkey"
      FOREIGN KEY ("pausado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atividade_pausas_retomado_por_id_fkey' AND conrelid = to_regclass('"atividade_pausas"')
  ) THEN
    ALTER TABLE "atividade_pausas" ADD CONSTRAINT "atividade_pausas_retomado_por_id_fkey"
      FOREIGN KEY ("retomado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
