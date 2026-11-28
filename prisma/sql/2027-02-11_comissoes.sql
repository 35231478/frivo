-- COM-1 — Comissões do vendedor.
-- ADITIVO e IDEMPOTENTE: pode rodar mais de uma vez. Não apaga, não renomeia e não muda tipo de nada.
-- O único UPDATE é o backfill da coluna NOVA orcamentos.vendedor_id (= quem criou), só onde ela está vazia.
-- Nenhum perfil de acesso é alterado: a permissão nova ("Trocar vendedor") nasce desmarcada; o administrador tem sempre.

-- 1) O vendedor do orçamento, da OS gerada e da fatura
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "vendedor_id" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "vendedor_id" TEXT;
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "vendedor_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_vendedor_id_fkey"
    FOREIGN KEY ("vendedor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_vendedor_id_fkey"
    FOREIGN KEY ("vendedor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "medicoes" ADD CONSTRAINT "medicoes_vendedor_id_fkey"
    FOREIGN KEY ("vendedor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "orcamentos_empresa_id_vendedor_id_idx" ON "orcamentos" ("empresa_id", "vendedor_id");

-- Backfill: o vendedor dos orçamentos que já existem é quem criou (só onde ainda está vazio)
UPDATE "orcamentos" SET "vendedor_id" = "criado_por_id" WHERE "vendedor_id" IS NULL;

-- 2) Categoria do serviço (regra "Sobre: categoria")
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "categoria" TEXT;

-- 3) Configuração da empresa: QUANDO a comissão fica devida e a base líquida de impostos
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "comissao_quando" TEXT NOT NULL DEFAULT 'RECEBIMENTO';
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "comissao_liquida_impostos" BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE "configuracoes" ADD CONSTRAINT "configuracoes_comissao_quando_check"
    CHECK ("comissao_quando" IN ('RECEBIMENTO', 'APROVACAO', 'CONCLUSAO_OS'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4) Regras de comissão
CREATE TABLE IF NOT EXISTS "comissao_regras" (
  "id"             TEXT          NOT NULL,
  "empresa_id"     TEXT          NOT NULL,
  "quem_tipo"      TEXT          NOT NULL,
  "usuario_id"     TEXT,
  "cargo_id"       TEXT,
  "papel"          TEXT          NOT NULL DEFAULT 'VENDEDOR',
  "sobre_tipo"     TEXT          NOT NULL,
  "categoria"      TEXT,
  "servico_id"     TEXT,
  "base"           TEXT          NOT NULL,
  "valor"          DECIMAL(12,4) NOT NULL,
  "ativo"          BOOLEAN       NOT NULL DEFAULT true,
  "criado_por_id"  TEXT,
  "criado_em"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em"  TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "comissao_regras_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comissao_regras_quem_check" CHECK ("quem_tipo" IN ('PESSOA', 'CARGO', 'TODOS')),
  CONSTRAINT "comissao_regras_papel_check" CHECK ("papel" IN ('VENDEDOR', 'EXECUTOR', 'RESPONSAVEL')),
  CONSTRAINT "comissao_regras_sobre_check" CHECK ("sobre_tipo" IN ('TODOS_SERVICOS', 'CATEGORIA', 'SERVICO', 'PECAS')),
  CONSTRAINT "comissao_regras_base_check" CHECK ("base" IN ('PERC_VENDA', 'PERC_LUCRO', 'FIXO_ITEM')),
  CONSTRAINT "comissao_regras_valor_check" CHECK ("valor" >= 0)
);
CREATE INDEX IF NOT EXISTS "comissao_regras_empresa_id_ativo_idx" ON "comissao_regras" ("empresa_id", "ativo");
DO $$ BEGIN
  ALTER TABLE "comissao_regras" ADD CONSTRAINT "comissao_regras_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_regras" ADD CONSTRAINT "comissao_regras_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_regras" ADD CONSTRAINT "comissao_regras_cargo_id_fkey"
    FOREIGN KEY ("cargo_id") REFERENCES "cargos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_regras" ADD CONSTRAINT "comissao_regras_servico_id_fkey"
    FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5) A comissão congelada por item (na aprovação do orçamento)
CREATE TABLE IF NOT EXISTS "comissoes" (
  "id"                 TEXT          NOT NULL,
  "empresa_id"         TEXT          NOT NULL,
  "orcamento_id"       TEXT          NOT NULL,
  "usuario_id"         TEXT,
  "beneficiario_nome"  TEXT          NOT NULL,
  "papel"              TEXT          NOT NULL DEFAULT 'VENDEDOR',
  "item_tipo"          TEXT          NOT NULL,
  "item_id"            TEXT          NOT NULL,
  "descricao"          TEXT          NOT NULL,
  "quantidade"         DECIMAL(12,3) NOT NULL,
  "regra_id"           TEXT,
  "regra_descricao"    TEXT          NOT NULL,
  "base"               TEXT          NOT NULL,
  "base_valor"         DECIMAL(12,2) NOT NULL,
  "taxa"               DECIMAL(12,4) NOT NULL,
  "valor"              DECIMAL(12,2) NOT NULL,
  "quando"             TEXT          NOT NULL,
  "liquida_impostos"   BOOLEAN       NOT NULL DEFAULT false,
  "criado_em"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comissoes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "comissoes_empresa_id_usuario_id_idx" ON "comissoes" ("empresa_id", "usuario_id");
CREATE INDEX IF NOT EXISTS "comissoes_orcamento_id_idx" ON "comissoes" ("orcamento_id");
DO $$ BEGIN
  ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_orcamento_id_fkey"
    FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_regra_id_fkey"
    FOREIGN KEY ("regra_id") REFERENCES "comissao_regras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6) Movimentos: liberação (+) e estorno (−); "paga" quando entra num fechamento do mês
CREATE TABLE IF NOT EXISTS "comissao_lancamentos" (
  "id"             TEXT          NOT NULL,
  "empresa_id"     TEXT          NOT NULL,
  "comissao_id"    TEXT          NOT NULL,
  "usuario_id"     TEXT,
  "tipo"           TEXT          NOT NULL,
  "valor"          DECIMAL(12,2) NOT NULL,
  "data"           TIMESTAMP(3)  NOT NULL,
  "motivo"         TEXT          NOT NULL,
  "fechamento_id"  TEXT,
  "criado_em"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comissao_lancamentos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comissao_lancamentos_tipo_check" CHECK ("tipo" IN ('LIBERACAO', 'ESTORNO'))
);
CREATE INDEX IF NOT EXISTS "comissao_lancamentos_empresa_id_usuario_id_idx" ON "comissao_lancamentos" ("empresa_id", "usuario_id");
CREATE INDEX IF NOT EXISTS "comissao_lancamentos_comissao_id_idx" ON "comissao_lancamentos" ("comissao_id");
CREATE INDEX IF NOT EXISTS "comissao_lancamentos_fechamento_id_idx" ON "comissao_lancamentos" ("fechamento_id");
DO $$ BEGIN
  ALTER TABLE "comissao_lancamentos" ADD CONSTRAINT "comissao_lancamentos_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_lancamentos" ADD CONSTRAINT "comissao_lancamentos_comissao_id_fkey"
    FOREIGN KEY ("comissao_id") REFERENCES "comissoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_lancamentos" ADD CONSTRAINT "comissao_lancamentos_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_lancamentos" ADD CONSTRAINT "comissao_lancamentos_fechamento_id_fkey"
    FOREIGN KEY ("fechamento_id") REFERENCES "desempenho_fechamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7) Fechamento do mês: total de comissões e, na folha, o usuário, a comissão e a conta a pagar gerada
ALTER TABLE "desempenho_fechamentos" ADD COLUMN IF NOT EXISTS "total_comissao" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "desempenho_fechamento_linhas" ADD COLUMN IF NOT EXISTS "usuario_id" TEXT;
ALTER TABLE "desempenho_fechamento_linhas" ADD COLUMN IF NOT EXISTS "comissao" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "desempenho_fechamento_linhas" ADD COLUMN IF NOT EXISTS "conta_pagar_id" TEXT;
CREATE INDEX IF NOT EXISTS "desempenho_fechamento_linhas_usuario_id_idx" ON "desempenho_fechamento_linhas" ("usuario_id");
DO $$ BEGIN
  ALTER TABLE "desempenho_fechamento_linhas" ADD CONSTRAINT "desempenho_fechamento_linhas_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "desempenho_fechamento_linhas" ADD CONSTRAINT "desempenho_fechamento_linhas_conta_pagar_id_fkey"
    FOREIGN KEY ("conta_pagar_id") REFERENCES "contas_pagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
