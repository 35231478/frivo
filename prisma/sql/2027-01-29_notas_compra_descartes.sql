-- NOTA DE COMPRA DESCARTADA: o registro de quem descartou, quando e por quê.
--
-- 🔵 PENDENTE — aplicar ANTES de subir o código desta leva (o Prisma passa a ler a tabela nova).
--
-- Notas de compra ganham "Descartar": apaga a nota IMPORTADA ou CONCILIADA que entrou por engano (XML
-- errado, de outra empresa, repetido). A nota LANÇADA não se descarta — o estorno continua pela conta a
-- pagar e pelo ajuste de estoque. Como a nota sai do banco (com os itens e a conciliação), a tabela nova
-- guarda qual era (chave, número, série, emitente, valor, emissão, situação), quem descartou, quando e o
-- motivo.
--
-- O QUE ENTRA (ADITIVO; nada é removido, alterado ou preenchido):
--   • Tabela "notas_compra_descartes", com chave estrangeira para "empresas" (ON DELETE CASCADE) e para
--     "usuarios" (ON DELETE SET NULL), e um índice por empresa e data.
--
-- O QUE NÃO MUDA: nenhuma nota existente é tocada; sem o descarte, a tabela fica vazia.
--
-- Pode rodar mais de uma vez.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-29_notas_compra_descartes.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "notas_compra_descartes" (
  "id"             TEXT NOT NULL,
  "empresa_id"     TEXT NOT NULL,
  "nota_id"        TEXT NOT NULL,
  "chave_acesso"   TEXT NOT NULL,
  "numero"         TEXT NOT NULL,
  "serie"          TEXT NOT NULL,
  "emitente_nome"  TEXT NOT NULL,
  "emitente_cnpj"  TEXT NOT NULL,
  "valor_total"    DECIMAL(12,2) NOT NULL,
  "data_emissao"   TIMESTAMP(3) NOT NULL,
  "status_na_hora" TEXT NOT NULL,
  "motivo"         TEXT,
  "usuario_id"     TEXT,
  "descartado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notas_compra_descartes_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notas_compra_descartes_empresa_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "notas_compra_descartes" ADD CONSTRAINT "notas_compra_descartes_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notas_compra_descartes_usuario_id_fkey' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE "notas_compra_descartes" ADD CONSTRAINT "notas_compra_descartes_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "notas_compra_descartes_empresa_id_descartado_em_idx"
  ON "notas_compra_descartes" ("empresa_id", "descartado_em");

COMMIT;
