-- Operações › Mapa: a última posição conhecida de cada técnico.
--
--   1. "configuracoes"."app_rastrear_localizacao": a permissão "Rastrear localização dos técnicos"
--      (Equipes › App do colaborador), por empresa. NOT NULL com DEFAULT false — é dado sensível (LGPD):
--      TODAS as empresas, as já cadastradas inclusive, começam com o rastreamento DESLIGADO. Desligado,
--      o app não captura nada, o servidor recusa o que chegar e o mapa fica vazio.
--   2. "tecnico_posicoes" (tabela nova): UMA linha por técnico — a última posição (latitude, longitude,
--      precisão), a bateria quando o aparelho informa, o horário da leitura e de onde veio (app web ou,
--      no futuro, o app nativo). A chave única em "tecnico_id" é o que garante "uma por técnico": a
--      leitura mais nova substitui a anterior. Não há histórico de trajeto.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): UMA coluna nova
-- e UMA tabela nova, com os índices e a chave estrangeira nos nomes que o Prisma gera. Nada existente
-- é removido nem alterado. As colunas antigas "tecnicos"."latitude" / "longitude" /
-- "ultima_localizacao" (preenchidas à mão pelo escritório) não são tocadas.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-08_mapa_posicao_tecnicos.sql

BEGIN;

ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "app_rastrear_localizacao" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "tecnico_posicoes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tecnico_id" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "precisao_m" DOUBLE PRECISION,
    "bateria" INTEGER,
    "carregando" BOOLEAN,
    "registrado_em" TIMESTAMP(3) NOT NULL,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivo" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'PWA',
    "usuario_id" TEXT,
    CONSTRAINT "tecnico_posicoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tecnico_posicoes_tecnico_id_key" ON "tecnico_posicoes"("tecnico_id");
CREATE INDEX IF NOT EXISTS "tecnico_posicoes_empresa_id_idx" ON "tecnico_posicoes"("empresa_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tecnico_posicoes_tecnico_id_fkey' AND conrelid = to_regclass('"tecnico_posicoes"')
  ) THEN
    ALTER TABLE "tecnico_posicoes" ADD CONSTRAINT "tecnico_posicoes_tecnico_id_fkey"
      FOREIGN KEY ("tecnico_id") REFERENCES "tecnicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
