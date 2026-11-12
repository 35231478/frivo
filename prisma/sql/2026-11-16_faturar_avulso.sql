-- Faturamento avulso ("Faturar" sobre a engine da medição). ADITIVO e IDEMPOTENTE: pode rodar 2×
-- sem efeito extra. Nada é apagado e nenhum dado existente muda.

-- Fatura avulsa: a medição criada pelo botão "Faturar" (orçamento/OS). As existentes ficam false.
ALTER TABLE "medicoes" ADD COLUMN IF NOT EXISTS "avulsa" BOOLEAN NOT NULL DEFAULT false;

-- Item da OS copiado do orçamento ("Gerar OS"): guarda de qual serviço do orçamento ele veio, para o
-- serviço (dados fiscais) chegar até a NFS-e. Itens já existentes ficam vazios (sem chute de vínculo).
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "orcamento_servico_id" TEXT;
CREATE INDEX IF NOT EXISTS "os_itens_orcamento_orcamento_servico_id_idx" ON "os_itens_orcamento" ("orcamento_servico_id");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'os_itens_orcamento_orcamento_servico_id_fkey' AND conrelid = 'os_itens_orcamento'::regclass
  ) THEN
    ALTER TABLE "os_itens_orcamento" ADD CONSTRAINT "os_itens_orcamento_orcamento_servico_id_fkey"
      FOREIGN KEY ("orcamento_servico_id") REFERENCES "orcamento_servicos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Retenções na fonte herdadas do serviço: além do "ISS retido" (iss_retido, já existe), a caixinha
-- "reter" de IR/PIS/COFINS/CSLL/INSS. A alíquota é a do próprio serviço (aliquota_ir/pis/cofins/csll,
-- já existem; aliquota_inss é nova). Padrão Simples Nacional: federais desmarcados (false) — nada muda
-- nos serviços existentes.
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "ret_ir" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "ret_pis" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "ret_cofins" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "ret_csll" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "ret_inss" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "servicos" ADD COLUMN IF NOT EXISTS "aliquota_inss" DECIMAL(5,2);
