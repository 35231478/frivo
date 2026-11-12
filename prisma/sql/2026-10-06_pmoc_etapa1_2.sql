-- PMOC — Etapa 1 (parte 2 de 2 do SQL): cadastro base (identificação, RT/ART, equipamentos cobertos).
-- PASSO 2 DE 2. Rodar DEPOIS do passo 1 (prisma/sql/2026-10-06_pmoc_etapa1_1_enum.sql), que cria o
-- tipo "StatusPmoc" usado aqui.
--
--   1. "pmocs" (tabela nova): o plano — cliente, unidade/local, nome, texto, datas de início e de
--      expiração, status gravado (Rascunho/Publicado), Responsável Técnico (nome e CREA em texto, com
--      vínculo opcional ao colaborador), ART (número e arquivo) e "ativo" (inativar não apaga).
--   2. "pmoc_equipamentos" (tabela nova): os equipamentos cobertos por cada plano; o mesmo equipamento
--      não entra duas vezes no mesmo plano (chave única em "pmoc_id" + "equipamento_id").
--
-- ADITIVO e IDEMPOTENTE (pode rodar mais de uma vez, sem erro e sem efeito repetido): DUAS tabelas
-- novas, com os índices e as chaves estrangeiras nos nomes que o Prisma gera. Nenhuma coluna é criada
-- em tabela existente; nada existente é removido nem alterado. Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-06_pmoc_etapa1_2.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "pmocs" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "data_inicio" DATE NOT NULL,
    "data_expiracao" DATE NOT NULL,
    "status" "StatusPmoc" NOT NULL DEFAULT 'RASCUNHO',
    "responsavel_tecnico_id" TEXT,
    "rt_nome" TEXT,
    "rt_crea" TEXT,
    "art_numero" TEXT,
    "art_arquivo" TEXT,
    "art_arquivo_nome" TEXT,
    "art_arquivo_tipo" TEXT,
    "art_arquivo_tamanho" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pmocs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pmoc_equipamentos" (
    "id" TEXT NOT NULL,
    "pmoc_id" TEXT NOT NULL,
    "equipamento_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pmoc_equipamentos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pmocs_empresa_id_ativo_idx" ON "pmocs"("empresa_id", "ativo");
CREATE INDEX IF NOT EXISTS "pmocs_cliente_id_idx" ON "pmocs"("cliente_id");
CREATE INDEX IF NOT EXISTS "pmocs_unidade_id_idx" ON "pmocs"("unidade_id");
CREATE INDEX IF NOT EXISTS "pmoc_equipamentos_equipamento_id_idx" ON "pmoc_equipamentos"("equipamento_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pmoc_equipamentos_pmoc_id_equipamento_id_key" ON "pmoc_equipamentos"("pmoc_id", "equipamento_id");

-- Chaves estrangeiras (cada uma só é criada se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_empresa_id_fkey' AND conrelid = to_regclass('"pmocs"')) THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_cliente_id_fkey' AND conrelid = to_regclass('"pmocs"')) THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_cliente_id_fkey"
      FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_unidade_id_fkey' AND conrelid = to_regclass('"pmocs"')) THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_unidade_id_fkey"
      FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_responsavel_tecnico_id_fkey' AND conrelid = to_regclass('"pmocs"')) THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_responsavel_tecnico_id_fkey"
      FOREIGN KEY ("responsavel_tecnico_id") REFERENCES "tecnicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_criado_por_id_fkey' AND conrelid = to_regclass('"pmocs"')) THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_criado_por_id_fkey"
      FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_equipamentos_pmoc_id_fkey' AND conrelid = to_regclass('"pmoc_equipamentos"')) THEN
    ALTER TABLE "pmoc_equipamentos" ADD CONSTRAINT "pmoc_equipamentos_pmoc_id_fkey"
      FOREIGN KEY ("pmoc_id") REFERENCES "pmocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_equipamentos_equipamento_id_fkey' AND conrelid = to_regclass('"pmoc_equipamentos"')) THEN
    ALTER TABLE "pmoc_equipamentos" ADD CONSTRAINT "pmoc_equipamentos_equipamento_id_fkey"
      FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
