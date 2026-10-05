-- Equipamentos: hierarquia de local (Setor) e início da garantia.
-- O projeto aplica o schema com `npm run db:push`; este script é o equivalente
-- manual, idempotente e apenas aditivo (colunas opcionais, sem perda de dados).
ALTER TABLE "equipamentos" ADD COLUMN IF NOT EXISTS "setor" TEXT;
ALTER TABLE "equipamentos" ADD COLUMN IF NOT EXISTS "garantia_inicio" TIMESTAMP(3);
