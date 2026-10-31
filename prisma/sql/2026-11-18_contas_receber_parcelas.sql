-- Contas a Receber — parcelas + baixa parcial. ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra.
-- Nada é apagado e nenhum dado existente muda: as colunas novas nascem vazias (valor_recebido = 0) e as
-- travas C6/C7 (índices únicos de medição/orçamento/contrato) ficam como estão.
--
-- Modelo: a conta que é dividida vira o LANÇAMENTO (status PARCELADO — guarda a origem, o total e as
-- notas fiscais; sai de todas as somas e listas) e cada parcela é uma linha de contas_receber com
-- lancamento_id (vencimento, valor, status e boleto próprios; sem origem própria — por isso não esbarra
-- nas travas únicas). Cada baixa (total ou parcial) é uma linha de conta_receber_recebimentos.

-- Status novo. Fora de transação no psql; dentro de uma (prisma db execute) também funciona no
-- PostgreSQL 12+ — o valor só não pode ser USADO na mesma transação, e este arquivo não usa.
ALTER TYPE "StatusContaReceber" ADD VALUE IF NOT EXISTS 'PARCELADO';

ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "valor_recebido" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "lancamento_id" TEXT;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "parcela_numero" INTEGER;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "parcela_total" INTEGER;
CREATE INDEX IF NOT EXISTS "contas_receber_lancamento_id_idx" ON "contas_receber" ("lancamento_id");

-- Recebimentos (cada baixa, com data, forma e conta bancária)
CREATE TABLE IF NOT EXISTS "conta_receber_recebimentos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "conta_receber_id" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "forma_pagamento" "FormaPagamento",
    "conta_bancaria_id" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "observacao" TEXT,
    "usuario_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conta_receber_recebimentos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "conta_receber_recebimentos_conta_receber_id_data_idx" ON "conta_receber_recebimentos" ("conta_receber_id", "data");
CREATE INDEX IF NOT EXISTS "conta_receber_recebimentos_empresa_id_data_idx" ON "conta_receber_recebimentos" ("empresa_id", "data");

-- Chaves estrangeiras e checagens (só cria se ainda não existir)
DO $$
BEGIN
  -- Parcela → lançamento: o lançamento não pode ser apagado enquanto tiver parcelas
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_lancamento_id_fkey' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_lancamento_id_fkey"
      FOREIGN KEY ("lancamento_id") REFERENCES "contas_receber" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- Recebido nunca negativo (o sistema também não deixa passar do valor)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_valor_recebido_check' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_valor_recebido_check" CHECK ("valor_recebido" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conta_receber_recebimentos_valor_check' AND conrelid = '"conta_receber_recebimentos"'::regclass) THEN
    ALTER TABLE "conta_receber_recebimentos" ADD CONSTRAINT "conta_receber_recebimentos_valor_check" CHECK ("valor" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conta_receber_recebimentos_empresa_id_fkey' AND conrelid = '"conta_receber_recebimentos"'::regclass) THEN
    ALTER TABLE "conta_receber_recebimentos" ADD CONSTRAINT "conta_receber_recebimentos_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conta_receber_recebimentos_conta_receber_id_fkey' AND conrelid = '"conta_receber_recebimentos"'::regclass) THEN
    ALTER TABLE "conta_receber_recebimentos" ADD CONSTRAINT "conta_receber_recebimentos_conta_receber_id_fkey"
      FOREIGN KEY ("conta_receber_id") REFERENCES "contas_receber" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conta_receber_recebimentos_conta_bancaria_id_fkey' AND conrelid = '"conta_receber_recebimentos"'::regclass) THEN
    ALTER TABLE "conta_receber_recebimentos" ADD CONSTRAINT "conta_receber_recebimentos_conta_bancaria_id_fkey"
      FOREIGN KEY ("conta_bancaria_id") REFERENCES "contas_bancarias" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conta_receber_recebimentos_usuario_id_fkey' AND conrelid = '"conta_receber_recebimentos"'::regclass) THEN
    ALTER TABLE "conta_receber_recebimentos" ADD CONSTRAINT "conta_receber_recebimentos_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
