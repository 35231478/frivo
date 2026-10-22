-- Leva 4 (faturamento da OS) — banco ADITIVO e IDEMPOTENTE (pode rodar mais de uma vez).
-- Rodar ANTES do merge/deploy:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-22_adicional_valor.sql
--
-- 1) Serviço adicional ganha PREÇO: ao marcar "Cobrar", o escritório informa o valor e o
--    adicional entra como item da medição da OS (origem de cobrança de verdade).
ALTER TABLE "servicos_adicionais" ADD COLUMN IF NOT EXISTS "valor" DECIMAL(12,2);

-- 2) A medição interna da OS (os_medicoes / os_itens_financeiro) saiu do sistema: nunca virava
--    conta a receber e só travava a OS. As tabelas antigas FICAM no banco (nada é apagado aqui,
--    este arquivo é só aditivo) — ficam órfãs e inertes; a limpeza definitiva pode ser feita em
--    uma manutenção futura com backup.
