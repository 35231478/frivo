-- Contas a Receber — marcar como perda + estorno de recebimento. ADITIVO e IDEMPOTENTE: pode rodar 2×
-- sem efeito extra. Nada é apagado e nenhum dado existente muda (as colunas novas nascem vazias).
-- Pré-requisito: 2026-11-18_contas_receber_parcelas.sql (tabela conta_receber_recebimentos).
--
-- Perda: status novo PERDA na cobrança (conta ou parcela) + quando/por quê/quanto/quem. O saldo sai do
-- a receber; o que já entrou continua recebido; a receita original NÃO é estornada (na DRE futura a
-- perda é despesa "Perdas com clientes" na data da marcação).
-- Estorno: o recebimento errado fica no histórico (riscado, com motivo e autor) e sai de todas as somas.

-- Status novo. Fora de transação no psql; dentro de uma (prisma db execute) também funciona no
-- PostgreSQL 12+ — o valor só não pode ser USADO na mesma transação, e este arquivo não usa.
ALTER TYPE "StatusContaReceber" ADD VALUE IF NOT EXISTS 'PERDA';

ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "perda_em" TIMESTAMP(3);
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "motivo_perda" TEXT;
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "valor_perda" DECIMAL(12,2);
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "perda_por_id" TEXT;
CREATE INDEX IF NOT EXISTS "contas_receber_empresa_id_perda_em_idx" ON "contas_receber" ("empresa_id", "perda_em");

ALTER TABLE "conta_receber_recebimentos" ADD COLUMN IF NOT EXISTS "estornado_em" TIMESTAMP(3);
ALTER TABLE "conta_receber_recebimentos" ADD COLUMN IF NOT EXISTS "motivo_estorno" TEXT;
ALTER TABLE "conta_receber_recebimentos" ADD COLUMN IF NOT EXISTS "estornado_por_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_perda_por_id_fkey' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_perda_por_id_fkey"
      FOREIGN KEY ("perda_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- Perda nunca negativa
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_receber_valor_perda_check' AND conrelid = '"contas_receber"'::regclass) THEN
    ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_valor_perda_check" CHECK ("valor_perda" IS NULL OR "valor_perda" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conta_receber_recebimentos_estornado_por_id_fkey' AND conrelid = '"conta_receber_recebimentos"'::regclass) THEN
    ALTER TABLE "conta_receber_recebimentos" ADD CONSTRAINT "conta_receber_recebimentos_estornado_por_id_fkey"
      FOREIGN KEY ("estornado_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Permissão nova "Financeiro › Perdas" (marcar e reverter perda): nos perfis Administrador que ainda não
-- têm a chave. Os outros perfis (Financeiro inclusive) recebem quando o administrador marcar em
-- Configurações › Perfis de acesso. Rodar 2× não muda nada; quem já tem true/false fica como está.
-- EXIGE SAIR E ENTRAR DE NOVO (a permissão vai na sessão).
UPDATE "perfis_acesso"
SET "permissoes" = jsonb_set("permissoes"::jsonb, '{financeiro,perdas}', 'true'::jsonb, true)
WHERE "tipo"::text = 'ADMINISTRADOR'
  AND ("permissoes"::jsonb ? 'financeiro')
  AND NOT (("permissoes"::jsonb -> 'financeiro') ? 'perdas');
