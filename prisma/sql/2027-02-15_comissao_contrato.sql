-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- COM-1.2 — Comissão sobre CONTRATO. Idempotente: pode rodar mais de uma vez sem mudar nada.
-- Aditivo: só colunas novas (todas opcionais ou com padrão) e três CHECKs AMPLIADOS (aceitam os valores
-- novos; tudo o que já está gravado continua valendo). Nenhum UPDATE: nada existente é reescrito, nenhum
-- perfil muda, e contrato antigo fica sem vendedor (não gera comissão: sem retroativo).
--
-- 1. contratos.vendedor_id: o vendedor do contrato (o da proposta que o originou, ou quem o criou).
-- 2. comissao_regras: "Sobre: Contratos" (tipo de contrato opcional) e as bases da mensalidade e do fixo,
--    com a janela de meses (0 = enquanto o contrato estiver ativo).
-- 3. comissoes: o contrato, a mensalidade (competência "AAAA-MM"), o 1º mês do ciclo e a janela.
-- 4. configuracoes.comissao_renovacao_gera: a renovação abre um ciclo novo (padrão: não).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1. O vendedor do contrato
ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "vendedor_id" TEXT;
CREATE INDEX IF NOT EXISTS "contratos_empresa_id_vendedor_id_idx" ON "contratos" ("empresa_id", "vendedor_id");
DO $$ BEGIN
  ALTER TABLE "contratos" ADD CONSTRAINT "contratos_vendedor_id_fkey"
    FOREIGN KEY ("vendedor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. As regras: "Sobre: Contratos", o tipo de contrato e a janela de meses
ALTER TABLE "comissao_regras" ADD COLUMN IF NOT EXISTS "tipo_contrato" TEXT;
ALTER TABLE "comissao_regras" ADD COLUMN IF NOT EXISTS "meses" INTEGER;
ALTER TABLE "comissao_regras" DROP CONSTRAINT IF EXISTS "comissao_regras_sobre_check";
ALTER TABLE "comissao_regras" ADD CONSTRAINT "comissao_regras_sobre_check"
  CHECK ("sobre_tipo" IN ('TODOS_SERVICOS', 'CATEGORIA', 'SERVICO', 'PECAS', 'CONTRATOS'));
ALTER TABLE "comissao_regras" DROP CONSTRAINT IF EXISTS "comissao_regras_base_check";
ALTER TABLE "comissao_regras" ADD CONSTRAINT "comissao_regras_base_check"
  CHECK ("base" IN ('PERC_VENDA', 'PERC_LUCRO', 'FIXO_ITEM', 'PERC_MENSALIDADE', 'FIXO_CONTRATO'));
DO $$ BEGIN
  ALTER TABLE "comissao_regras" ADD CONSTRAINT "comissao_regras_tipo_contrato_check" CHECK ("tipo_contrato" IS NULL OR "tipo_contrato" IN (
    'MANUTENCAO_PREVENTIVA', 'MANUTENCAO_CORRETIVA', 'MANUTENCAO_COMPLETA', 'INSTALACAO', 'LOCACAO', 'ASSISTENCIA_TECNICA'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "comissao_regras" ADD CONSTRAINT "comissao_regras_meses_check" CHECK ("meses" IS NULL OR "meses" BETWEEN 0 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. A comissão sobre contrato: de onde vem e a mensalidade
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "contrato_id" TEXT;
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "competencia" TEXT;
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "ciclo_inicio" TEXT;
ALTER TABLE "comissoes" ADD COLUMN IF NOT EXISTS "meses" INTEGER;
CREATE INDEX IF NOT EXISTS "comissoes_contrato_id_idx" ON "comissoes" ("contrato_id");
DO $$ BEGIN
  ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_contrato_id_fkey"
    FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- A comissão vem de um orçamento (vendedor), de uma OS (técnico) ou de um contrato (COM-1.2): uma delas sempre existe
ALTER TABLE "comissoes" DROP CONSTRAINT IF EXISTS "comissoes_origem_check";
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_origem_check"
  CHECK ("orcamento_id" IS NOT NULL OR "ordem_servico_id" IS NOT NULL OR "contrato_id" IS NOT NULL);

-- 4. Configurações › Comissões: a renovação também gera?
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "comissao_renovacao_gera" BOOLEAN NOT NULL DEFAULT false;
