-- Contas a Receber — gestão (edição completa, baixa, cancelar com motivo, excluir, histórico) e o
-- cadastro de Contas bancárias. ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado
-- e nenhum dado existente muda (as colunas novas nascem vazias; o texto `banco` antigo continua).

-- Cadastro de contas bancárias da empresa
CREATE TABLE IF NOT EXISTS "contas_bancarias" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "banco" TEXT,
    "agencia" TEXT,
    "conta" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contas_bancarias_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "contas_bancarias_empresa_id_ativo_idx" ON "contas_bancarias" ("empresa_id", "ativo");

-- Conta a receber: centro de custo, conta bancária, cancelamento com motivo, exclusão lógica
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "centro_custo_id" TEXT;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "conta_bancaria_id" TEXT;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "cancelada_em" TIMESTAMP(3);
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "motivo_cancelamento" TEXT;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "excluida_em" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "contas_receber_centro_custo_id_idx" ON "contas_receber" ("centro_custo_id");
CREATE INDEX IF NOT EXISTS "contas_receber_conta_bancaria_id_idx" ON "contas_receber" ("conta_bancaria_id");

-- Linha do tempo da conta a receber
CREATE TABLE IF NOT EXISTS "conta_receber_eventos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "conta_receber_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "detalhe" TEXT,
    "usuario_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conta_receber_eventos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "conta_receber_eventos_conta_receber_id_criado_em_idx" ON "conta_receber_eventos" ("conta_receber_id", "criado_em");
CREATE INDEX IF NOT EXISTS "conta_receber_eventos_empresa_id_idx" ON "conta_receber_eventos" ("empresa_id");

-- Chaves estrangeiras (só cria se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_bancarias_empresa_id_fkey' AND conrelid = '"contas_bancarias"'::regclass) THEN
    ALTER TABLE "contas_bancarias" ADD CONSTRAINT "contas_bancarias_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_centro_custo_id_fkey' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_centro_custo_id_fkey"
      FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_conta_bancaria_id_fkey' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_conta_bancaria_id_fkey"
      FOREIGN KEY ("conta_bancaria_id") REFERENCES "contas_bancarias" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conta_receber_eventos_empresa_id_fkey' AND conrelid = '"conta_receber_eventos"'::regclass) THEN
    ALTER TABLE "conta_receber_eventos" ADD CONSTRAINT "conta_receber_eventos_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conta_receber_eventos_conta_receber_id_fkey' AND conrelid = '"conta_receber_eventos"'::regclass) THEN
    ALTER TABLE "conta_receber_eventos" ADD CONSTRAINT "conta_receber_eventos_conta_receber_id_fkey"
      FOREIGN KEY ("conta_receber_id") REFERENCES "contas_receber" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conta_receber_eventos_usuario_id_fkey' AND conrelid = '"conta_receber_eventos"'::regclass) THEN
    ALTER TABLE "conta_receber_eventos" ADD CONSTRAINT "conta_receber_eventos_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
