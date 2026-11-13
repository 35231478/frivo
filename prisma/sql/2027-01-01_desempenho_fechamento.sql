-- DESEMPENHO (manutenção) — PR 2: PAGAR. Fechamento mensal e folha de bônus.
--
-- O que entra (tudo ADITIVO; nada é removido, alterado nem preenchido):
--   1. "desempenho_fechamentos": o fechamento de um mês. Guarda o painel como estava ao fechar
--      (ranking, composição, regra e valores), quem ganhou a premiação, o total, quem fechou e quando.
--      Reabrir NÃO apaga: marca "REABERTO" com quem, quando e por quê; fechar de novo cria a versão
--      seguinte ("versao"). Um mês tem no máximo um fechamento por versão.
--   2. "desempenho_fechamento_linhas": a folha de bônus do fechamento — uma linha por colaborador,
--      com escore, faixa e o VALOR definitivo do bônus. Só o valor é registrado; pagamento, imposto e
--      encargo são lançados no financeiro.
--
-- Nenhuma tabela existente ganha, perde ou muda coluna. As duas tabelas nascem vazias.
--
-- IDEMPOTENTE: IF NOT EXISTS em tabelas e índices; cada chave estrangeira só é criada quando ainda
-- não existe. Pode rodar mais de uma vez. Sem enum (a situação é TEXTO). Não usa `prisma migrate`.
--
-- Depende do SQL do PR 1 (2026-12-31_desempenho.sql), que já está em produção.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-01_desempenho_fechamento.sql

BEGIN;

-- 1. Tabelas
CREATE TABLE IF NOT EXISTS "desempenho_fechamentos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "situacao" TEXT NOT NULL DEFAULT 'FECHADO',
    "painel" JSONB NOT NULL,
    "premios" JSONB NOT NULL,
    "total_bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fechado_por_id" TEXT,
    "fechado_por_nome" TEXT NOT NULL,
    "fechado_em" TIMESTAMP(3) NOT NULL,
    "reaberto_por_id" TEXT,
    "reaberto_por_nome" TEXT,
    "reaberto_em" TIMESTAMP(3),
    "reabertura_motivo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desempenho_fechamentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "desempenho_fechamento_linhas" (
    "id" TEXT NOT NULL,
    "fechamento_id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tecnico_id" TEXT,
    "nome" TEXT NOT NULL,
    "perfil" TEXT NOT NULL,
    "posicao" INTEGER,
    "escore" DECIMAL(5,1),
    "faixa" TEXT,
    "valor" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desempenho_fechamento_linhas_pkey" PRIMARY KEY ("id")
);

-- 2. Índices e unicidades
CREATE INDEX IF NOT EXISTS "desempenho_fechamentos_empresa_id_situacao_idx" ON "desempenho_fechamentos"("empresa_id", "situacao");
CREATE UNIQUE INDEX IF NOT EXISTS "desempenho_fechamentos_empresa_id_competencia_versao_key" ON "desempenho_fechamentos"("empresa_id", "competencia", "versao");
CREATE INDEX IF NOT EXISTS "desempenho_fechamento_linhas_fechamento_id_idx" ON "desempenho_fechamento_linhas"("fechamento_id");
CREATE INDEX IF NOT EXISTS "desempenho_fechamento_linhas_tecnico_id_idx" ON "desempenho_fechamento_linhas"("tecnico_id");
CREATE INDEX IF NOT EXISTS "desempenho_fechamento_linhas_empresa_id_idx" ON "desempenho_fechamento_linhas"("empresa_id");

-- 3. Chaves estrangeiras (cada uma só é criada se ainda não existir)
DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"desempenho_fechamentos"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_fechamentos_empresa_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_fechamentos" ADD CONSTRAINT "desempenho_fechamentos_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_fechamentos_fechado_por_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_fechamentos" ADD CONSTRAINT "desempenho_fechamentos_fechado_por_id_fkey"
      FOREIGN KEY ("fechado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_fechamentos_reaberto_por_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_fechamentos" ADD CONSTRAINT "desempenho_fechamentos_reaberto_por_id_fkey"
      FOREIGN KEY ("reaberto_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"desempenho_fechamento_linhas"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_fechamento_linhas_fechamento_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_fechamento_linhas" ADD CONSTRAINT "desempenho_fechamento_linhas_fechamento_id_fkey"
      FOREIGN KEY ("fechamento_id") REFERENCES "desempenho_fechamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_fechamento_linhas_empresa_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_fechamento_linhas" ADD CONSTRAINT "desempenho_fechamento_linhas_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desempenho_fechamento_linhas_tecnico_id_fkey' AND conrelid = tabela) THEN
    ALTER TABLE "desempenho_fechamento_linhas" ADD CONSTRAINT "desempenho_fechamento_linhas_tecnico_id_fkey"
      FOREIGN KEY ("tecnico_id") REFERENCES "tecnicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
