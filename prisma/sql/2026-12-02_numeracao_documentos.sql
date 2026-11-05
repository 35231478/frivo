-- Numeração de documentos (Configurações) — o PRÓXIMO número de cada tipo de documento por empresa
-- (orçamento, OS, chamado, contrato, medição/fatura, pedido de compra, conta a receber/pagar,
-- relatório da OS, QR Code). A sequência passa a ser CONTÍNUA (não reinicia no ano).
-- Sem linha para um tipo, o código semeia no 1º uso com o maior número já usado + 1: nada muda nos
-- documentos existentes e nenhuma numeração anda para trás.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado.

-- 1) A tabela de contadores
CREATE TABLE IF NOT EXISTS "numeracoes" (
  "id"            TEXT NOT NULL,
  "empresa_id"    TEXT NOT NULL,
  "tipo"          TEXT NOT NULL,
  "proximo"       INTEGER NOT NULL,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "numeracoes_pkey" PRIMARY KEY ("id")
);

-- 2) Um contador por empresa e tipo
CREATE UNIQUE INDEX IF NOT EXISTS "numeracoes_empresa_id_tipo_key" ON "numeracoes"("empresa_id", "tipo");

-- 3) Apagar a empresa apaga os contadores dela
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'numeracoes_empresa_id_fkey' AND conrelid = '"numeracoes"'::regclass) THEN
    ALTER TABLE "numeracoes" ADD CONSTRAINT "numeracoes_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
