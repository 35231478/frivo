-- Faturamento (Opção A, parte segura): travas contra cobrança em dobro (C6/C7) e retenções na fonte.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado e nenhum dado existente muda.
-- Pré-requisito: 2026-11-12_contas_receber_gestao.sql (coluna excluida_em). A linha abaixo só garante a
-- coluna caso a ordem tenha sido invertida.
ALTER TABLE "contas_receber" ADD COLUMN IF NOT EXISTS "excluida_em" TIMESTAMP(3);

-- Retenções na fonte da medição (alíquota %; NULL = desmarcada) e o total retido.
-- Conta a receber/boleto = valor_liquido − valor_retencoes. Medições existentes ficam com 0 (nada muda).
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "ret_iss_aliquota" DECIMAL(5,2);
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "ret_ir_aliquota" DECIMAL(5,2);
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "ret_pis_aliquota" DECIMAL(5,2);
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "ret_cofins_aliquota" DECIMAL(5,2);
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "ret_csll_aliquota" DECIMAL(5,2);
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "ret_inss_aliquota" DECIMAL(5,2);
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "valor_retencoes" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- (b) Uma medição tem no máximo UMA conta a receber avulsa viva (as de contrato são por competência e
-- já têm o único contrato + mês). (c) Um orçamento tem no máximo UMA conta a receber viva.
-- Se o banco JÁ tiver duplicatas, o índice NÃO é criado (nada é apagado às cegas): o script avisa e
-- segue; a trava por transação no sistema continua valendo. Liste as duplicatas com
-- prisma/sql/diagnostico/faturamento-duplicidades.sql, resolva no Financeiro e rode este SQL de novo.
DO $$
DECLARE dup INTEGER;
BEGIN
  IF to_regclass('contas_receber_medicao_avulsa_viva_key') IS NULL THEN
    SELECT count(*) INTO dup FROM (
      SELECT medicao_id FROM contas_receber
       WHERE medicao_id IS NOT NULL AND contrato_id IS NULL AND status <> 'CANCELADO' AND excluida_em IS NULL
       GROUP BY medicao_id HAVING count(*) > 1) d;
    IF dup = 0 THEN
      CREATE UNIQUE INDEX "contas_receber_medicao_avulsa_viva_key" ON "contas_receber" ("medicao_id")
        WHERE medicao_id IS NOT NULL AND contrato_id IS NULL AND status <> 'CANCELADO' AND excluida_em IS NULL;
    ELSE
      RAISE WARNING 'Trava (b) NÃO criada: % medição(ões) já têm mais de uma conta a receber avulsa viva. Veja o diagnóstico.', dup;
    END IF;
  END IF;

  IF to_regclass('contas_receber_orcamento_viva_key') IS NULL THEN
    SELECT count(*) INTO dup FROM (
      SELECT orcamento_id FROM contas_receber
       WHERE orcamento_id IS NOT NULL AND status <> 'CANCELADO' AND excluida_em IS NULL
       GROUP BY orcamento_id HAVING count(*) > 1) d;
    IF dup = 0 THEN
      CREATE UNIQUE INDEX "contas_receber_orcamento_viva_key" ON "contas_receber" ("orcamento_id")
        WHERE orcamento_id IS NOT NULL AND status <> 'CANCELADO' AND excluida_em IS NULL;
    ELSE
      RAISE WARNING 'Trava (c) NÃO criada: % orçamento(s) já têm mais de uma conta a receber viva. Veja o diagnóstico.', dup;
    END IF;
  END IF;
END $$;
