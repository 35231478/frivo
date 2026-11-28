-- COM-1.1 — o vencimento da conta a pagar do fechamento do mês (bônus + comissão), em Configurações › Comissões.
-- ADITIVO e idempotente (pode rodar mais de uma vez). Nada existente é apagado ou reescrito.
--   comissao_vencimento_tipo: 'DIA_UTIL' (o N-º dia útil, seg–sex, do mês seguinte à competência) | 'DIA_FIXO' (o dia N)
--   comissao_vencimento_dia:  N — DIA_UTIL de 1 a 20; DIA_FIXO de 1 a 31 (além do fim do mês = o último dia)
-- Padrão: 5º dia útil do mês seguinte. (Antes: dia 5 fixo, sem a configuração.)

ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "comissao_vencimento_tipo" TEXT NOT NULL DEFAULT 'DIA_UTIL';
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "comissao_vencimento_dia" INTEGER NOT NULL DEFAULT 5;

DO $$ BEGIN
  ALTER TABLE "configuracoes" ADD CONSTRAINT "configuracoes_comissao_vencimento_check" CHECK (
    ("comissao_vencimento_tipo" = 'DIA_UTIL' AND "comissao_vencimento_dia" BETWEEN 1 AND 20)
    OR ("comissao_vencimento_tipo" = 'DIA_FIXO' AND "comissao_vencimento_dia" BETWEEN 1 AND 31)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
