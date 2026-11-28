-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- COM-2A — Comissão do EXECUTOR (técnico). Idempotente: pode rodar mais de uma vez sem mudar nada.
-- Aditivo, com UMA flexibilização (avisada no PR): comissoes.orcamento_id deixa de ser obrigatório, porque a
-- comissão do técnico nasce da OS (que pode não ter orçamento). Nada é apagado nem convertido; as comissões do
-- vendedor (COM-1) continuam exatamente como estão.
--
-- 1. comissao_regras: como dividir entre os técnicos da atividade (IGUAL | POR_EXECUTOR | POR_CARGO) e os % por cargo.
-- 2. comissoes: a OS, a atividade, o equipamento e a linha da OS de onde a comissão do técnico vem; a parte dele
--    na divisão (congelada); a chave única (uma comissão por atividade × equipamento × linha × pessoa).
-- 3. comissao_lancamentos: o teto do mês (o excedente vira um par −/+ que passa para o mês seguinte).
-- 4. configuracoes: quando a comissão do técnico fica devida e os dias do retorno.
-- 5. comissao_tetos (teto mensal por pessoa ou cargo) e comissao_revisoes (retorno no mesmo equipamento a revisar).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1. A divisão entre os técnicos
ALTER TABLE "comissao_regras" ADD COLUMN IF NOT EXISTS "divisao" TEXT NOT NULL DEFAULT 'IGUAL';
ALTER TABLE "comissao_regras" ADD COLUMN IF NOT EXISTS "divisao_cargos" JSONB;
DO $$ BEGIN
  ALTER TABLE "comissao_regras" ADD CONSTRAINT "comissao_regras_divisao_check" CHECK ("divisao" IN ('IGUAL', 'POR_EXECUTOR', 'POR_CARGO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. A comissão do técnico: de onde vem e a parte dele
ALTER TABLE "comissoes" ALTER COLUMN "orcamento_id" DROP NOT NULL;
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "ordem_servico_id" TEXT;
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "atividade_id" TEXT;
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "equipamento_id" TEXT;
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "parte" DECIMAL(7,4) NOT NULL DEFAULT 1;
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "divisao" TEXT;
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "chave" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "comissoes_empresa_id_chave_key" ON "comissoes" ("empresa_id", "chave");
CREATE INDEX IF NOT EXISTS "comissoes_ordem_servico_id_idx" ON "comissoes" ("ordem_servico_id");
DO $$ BEGIN
  ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_ordem_servico_id_fkey"
    FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_parte_check" CHECK ("parte" >= 0 AND "parte" <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- A comissão vem de um orçamento (vendedor) ou de uma OS (técnico): uma das duas sempre existe
DO $$ BEGIN
  ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_origem_check" CHECK ("orcamento_id" IS NOT NULL OR "ordem_servico_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. O teto do mês
ALTER TABLE "comissao_lancamentos" ADD COLUMN IF NOT EXISTS "teto_competencia" TEXT;
CREATE INDEX IF NOT EXISTS "comissao_lancamentos_empresa_id_teto_competencia_idx" ON "comissao_lancamentos" ("empresa_id", "teto_competencia");

-- 4. Configurações › Comissões: o técnico
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "comissao_executor_quando" TEXT NOT NULL DEFAULT 'CONCLUSAO_OS';
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "comissao_retorno_dias" INTEGER NOT NULL DEFAULT 30;
DO $$ BEGIN
  ALTER TABLE "configuracoes" ADD CONSTRAINT "configuracoes_comissao_executor_quando_check"
    CHECK ("comissao_executor_quando" IN ('CONCLUSAO_OS', 'ACEITE', 'RECEBIMENTO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "configuracoes" ADD CONSTRAINT "configuracoes_comissao_retorno_dias_check" CHECK ("comissao_retorno_dias" BETWEEN 0 AND 365);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5a. O teto mensal (por pessoa ou por cargo; a pessoa vence o cargo)
CREATE TABLE IF NOT EXISTS "comissao_tetos" (
  "id"            TEXT          NOT NULL,
  "empresa_id"    TEXT          NOT NULL,
  "quem_tipo"     TEXT          NOT NULL,
  "usuario_id"    TEXT,
  "cargo_id"      TEXT,
  "valor"         DECIMAL(12,2) NOT NULL,
  "ativo"         BOOLEAN       NOT NULL DEFAULT true,
  "criado_em"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "comissao_tetos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comissao_tetos_quem_check" CHECK ("quem_tipo" IN ('PESSOA', 'CARGO')),
  CONSTRAINT "comissao_tetos_valor_check" CHECK ("valor" > 0)
);
CREATE INDEX IF NOT EXISTS "comissao_tetos_empresa_id_ativo_idx" ON "comissao_tetos" ("empresa_id", "ativo");
DO $$ BEGIN
  ALTER TABLE "comissao_tetos" ADD CONSTRAINT "comissao_tetos_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_tetos" ADD CONSTRAINT "comissao_tetos_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_tetos" ADD CONSTRAINT "comissao_tetos_cargo_id_fkey"
    FOREIGN KEY ("cargo_id") REFERENCES "cargos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5b. O retorno no mesmo equipamento: a comissão do técnico fica em revisão (o encarregado decide)
CREATE TABLE IF NOT EXISTS "comissao_revisoes" (
  "id"                TEXT         NOT NULL,
  "empresa_id"        TEXT         NOT NULL,
  "comissao_id"       TEXT         NOT NULL,
  "os_retorno_id"     TEXT         NOT NULL,
  "equipamento_id"    TEXT,
  "situacao"          TEXT         NOT NULL DEFAULT 'A_REVISAR',
  "descricao"         TEXT         NOT NULL,
  "motivo"            TEXT,
  "decidido_por_id"   TEXT,
  "decidido_por_nome" TEXT,
  "decidido_em"       TIMESTAMP(3),
  "criado_em"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comissao_revisoes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comissao_revisoes_situacao_check" CHECK ("situacao" IN ('A_REVISAR', 'ESTORNAR', 'MANTER'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "comissao_revisoes_comissao_id_os_retorno_id_key" ON "comissao_revisoes" ("comissao_id", "os_retorno_id");
CREATE INDEX IF NOT EXISTS "comissao_revisoes_empresa_id_situacao_idx" ON "comissao_revisoes" ("empresa_id", "situacao");
DO $$ BEGIN
  ALTER TABLE "comissao_revisoes" ADD CONSTRAINT "comissao_revisoes_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_revisoes" ADD CONSTRAINT "comissao_revisoes_comissao_id_fkey"
    FOREIGN KEY ("comissao_id") REFERENCES "comissoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_revisoes" ADD CONSTRAINT "comissao_revisoes_os_retorno_id_fkey"
    FOREIGN KEY ("os_retorno_id") REFERENCES "ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
