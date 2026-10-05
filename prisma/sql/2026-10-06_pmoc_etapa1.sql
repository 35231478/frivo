-- PMOC — Etapa 1 (cadastro base: identificação, RT/ART, equipamentos cobertos).
-- O projeto aplica o schema com `npm run db:push`; este script é o equivalente
-- manual, idempotente e apenas aditivo: cria 1 enum e 2 tabelas novas, sem
-- alterar nem apagar nada que já existe. Pode ser rodado mais de uma vez.

-- Status gravado do PMOC (Vigente/Expirado são calculados pelas datas na aplicação)
DO $$ BEGIN
  CREATE TYPE "StatusPmoc" AS ENUM ('RASCUNHO', 'PUBLICADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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

-- Chaves estrangeiras (só cria se ainda não existir)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_empresa_id_fkey') THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_cliente_id_fkey') THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_unidade_id_fkey') THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_responsavel_tecnico_id_fkey') THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_responsavel_tecnico_id_fkey" FOREIGN KEY ("responsavel_tecnico_id") REFERENCES "tecnicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmocs_criado_por_id_fkey') THEN
    ALTER TABLE "pmocs" ADD CONSTRAINT "pmocs_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_equipamentos_pmoc_id_fkey') THEN
    ALTER TABLE "pmoc_equipamentos" ADD CONSTRAINT "pmoc_equipamentos_pmoc_id_fkey" FOREIGN KEY ("pmoc_id") REFERENCES "pmocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmoc_equipamentos_equipamento_id_fkey') THEN
    ALTER TABLE "pmoc_equipamentos" ADD CONSTRAINT "pmoc_equipamentos_equipamento_id_fkey" FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
