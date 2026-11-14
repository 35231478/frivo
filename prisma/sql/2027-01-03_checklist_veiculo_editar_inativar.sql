-- Checklist de veículo preenchido: corrigir (editar) e excluir de forma REVERSÍVEL (inativar).
--
--   "checklist_preenchidos"."editado_em" / "editado_por_id": quando e quem corrigiu as respostas
--     depois de enviado. NULL = nunca editado.
--   "checklist_preenchidos"."inativado_em" / "inativado_por_id": quando e quem inativou. NULL = ativo.
--     O checklist inativado sai da lista e das contagens ("checklist de hoje", "com alertas"), mas
--     continua no banco com todas as respostas e fotos — reativar é limpar essas duas colunas.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido): QUATRO colunas
-- novas, todas anuláveis e sem valor padrão, duas chaves estrangeiras para "usuarios" (ON DELETE SET NULL)
-- e um índice. Nada existente é removido nem alterado: todo checklist já gravado continua ATIVO e
-- "nunca editado".
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-03_checklist_veiculo_editar_inativar.sql

BEGIN;

ALTER TABLE "checklist_preenchidos" ADD COLUMN IF NOT EXISTS "editado_em" TIMESTAMP(3);
ALTER TABLE "checklist_preenchidos" ADD COLUMN IF NOT EXISTS "editado_por_id" TEXT;
ALTER TABLE "checklist_preenchidos" ADD COLUMN IF NOT EXISTS "inativado_em" TIMESTAMP(3);
ALTER TABLE "checklist_preenchidos" ADD COLUMN IF NOT EXISTS "inativado_por_id" TEXT;

-- Chaves estrangeiras (cada uma só é criada se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_preenchidos_editado_por_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "checklist_preenchidos" ADD CONSTRAINT "checklist_preenchidos_editado_por_id_fkey"
      FOREIGN KEY ("editado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_preenchidos_inativado_por_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "checklist_preenchidos" ADD CONSTRAINT "checklist_preenchidos_inativado_por_id_fkey"
      FOREIGN KEY ("inativado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- A lista de checklists é sempre por empresa, só os ativos, do mais novo para o mais antigo
CREATE INDEX IF NOT EXISTS "checklist_preenchidos_empresa_id_inativado_em_criado_em_idx"
  ON "checklist_preenchidos" ("empresa_id", "inativado_em", "criado_em");

COMMIT;
