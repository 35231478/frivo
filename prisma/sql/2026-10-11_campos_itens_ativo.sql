-- Leva 1 — editar Formulários e Checklists de veículo sem apagar o histórico.
-- Aditivo e idempotente (pode rodar mais de uma vez). Só ADICIONA uma coluna `ativo` em 2 tabelas;
-- não altera nem apaga nada que já existe. Todo campo/item atual fica ativo (DEFAULT true).
-- No PostgreSQL 11+, ADD COLUMN com DEFAULT constante não reescreve a tabela (instantâneo).
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção.

BEGIN;

-- Campo de formulário removido na edição vira ativo=false (as respostas antigas continuam apontando para ele)
ALTER TABLE "formulario_campos" ADD COLUMN IF NOT EXISTS "ativo" BOOLEAN NOT NULL DEFAULT true;

-- Item de checklist de veículo removido na edição vira ativo=false (checklists já preenchidos continuam apontando para ele)
ALTER TABLE "checklist_item_templates" ADD COLUMN IF NOT EXISTS "ativo" BOOLEAN NOT NULL DEFAULT true;

COMMIT;
