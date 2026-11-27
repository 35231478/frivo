-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- "Exportar dados da empresa (backup portátil)" (aditivo e idempotente: pode rodar mais de uma vez sem mudar nada)
--
-- exportacoes_dados = a trilha de cada exportação: quem (id e nome da hora), quando, qual parte e se terminou.
--   - gravada ANTES de gerar o arquivo (sem o registro, não há exportação);
--   - concluida_em/arquivos/linhas preenchidos quando o zip termina; nulo = interrompida;
--   - usuario_id sem chave estrangeira: a trilha não some se o usuário for removido; some com a empresa.
-- Nada existente é alterado.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "exportacoes_dados" (
  "id"            TEXT         NOT NULL,
  "empresa_id"    TEXT         NOT NULL,
  "usuario_id"    TEXT         NOT NULL,
  "usuario_nome"  TEXT         NOT NULL,
  "parte"         TEXT         NOT NULL,
  "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "concluida_em"  TIMESTAMP(3),
  "arquivos"      INTEGER,
  "linhas"        INTEGER,
  "erro"          TEXT,
  CONSTRAINT "exportacoes_dados_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "exportacoes_dados_empresa_id_criado_em_idx" ON "exportacoes_dados" ("empresa_id", "criado_em");

DO $$ BEGIN
  ALTER TABLE "exportacoes_dados" ADD CONSTRAINT "exportacoes_dados_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
