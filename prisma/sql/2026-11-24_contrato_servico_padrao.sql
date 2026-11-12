-- Contrato recorrente — PR2: SERVIÇO PADRÃO do contrato. A medição mensal do contrato nasce com
-- esse serviço no item: a NFS-e sai sem a pendência "vincule o serviço" e as retenções vêm do
-- cadastro do serviço (mesma regra do "Faturar").
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado e nada é preenchido
-- sozinho (os contratos existentes ficam sem serviço padrão e continuam como hoje).
--  - apagar o serviço NÃO apaga o contrato (a referência vira nula).

ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "servico_id" TEXT;

CREATE INDEX IF NOT EXISTS "contratos_servico_id_idx" ON "contratos" ("servico_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contratos_servico_id_fkey' AND conrelid = '"contratos"'::regclass) THEN
    ALTER TABLE "contratos" ADD CONSTRAINT "contratos_servico_id_fkey"
      FOREIGN KEY ("servico_id") REFERENCES "servicos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
