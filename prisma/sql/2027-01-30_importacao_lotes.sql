-- IMPLANTAÇÃO: LOTES DE IMPORTAÇÃO E "DESFAZER LOTE".
--
-- 🔵 PENDENTE — aplicar ANTES de subir o código desta leva (o Prisma passa a gravar nestas tabelas a cada importação).
--
-- Cada importação por planilha vira um LOTE: quem importou, quando, o arquivo, a planilha e as contagens. O lote guarda
-- cada registro que CRIOU ou ATUALIZOU. "Desfazer lote" (tela de Implantação) apaga só o que o lote CRIOU e ainda não
-- foi usado; o que ele só ATUALIZOU nunca é desfeito (só é listado).
--
-- O LEVANTAMENTO (o que já existia e continua igual):
--   • A importação por planilha (clientes, unidades, contatos, equipamentos, fornecedores, serviços, produtos, estoque,
--     colaboradores e veículos) grava direto nos cadastros e não guardava nenhum registro do que fez.
--   • Os cadastros não mudam: nenhuma coluna nova neles.
--
-- O QUE ENTRA (ADITIVO; nada é removido, alterado ou preenchido):
--   1. Tipo "AcaoLoteItem": CRIADO | ATUALIZADO.
--   2. Tabela "importacao_lotes": um por importação confirmada (empresa, quem, planilha, arquivo, contagens, quando foi
--      desfeito e por quem, quantos registros o desfazer apagou).
--   3. Tabela "importacao_lote_itens": um por registro criado ou atualizado pelo lote (qual cadastro, qual registro, a
--      linha da planilha, se já foi desfeito).
--
-- O QUE NÃO MUDA:
--   • As importações feitas antes desta leva não viram lote (não há registro do que fizeram). Sem preenchimento retroativo.
--   • Apagar uma empresa apaga os lotes dela (como o resto dos dados dela). Apagar um usuário não apaga o lote: o "quem"
--     fica vazio.
--
-- Pode rodar mais de uma vez.

-- 1. A ação de cada item
DO $$ BEGIN
  CREATE TYPE "AcaoLoteItem" AS ENUM ('CRIADO', 'ATUALIZADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. O lote
CREATE TABLE IF NOT EXISTS "importacao_lotes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "entidade" TEXT NOT NULL,
    "arquivo" TEXT NOT NULL,
    "criados" INTEGER NOT NULL DEFAULT 0,
    "atualizados" INTEGER NOT NULL DEFAULT 0,
    "com_erro" INTEGER NOT NULL DEFAULT 0,
    "avisos" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desfeito_em" TIMESTAMP(3),
    "desfeito_por_id" TEXT,
    "apagados" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "importacao_lotes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "importacao_lotes_empresa_id_criado_em_idx" ON "importacao_lotes"("empresa_id", "criado_em");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'importacao_lotes_empresa_id_fkey' AND conrelid = '"importacao_lotes"'::regclass) THEN
    ALTER TABLE "importacao_lotes" ADD CONSTRAINT "importacao_lotes_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'importacao_lotes_usuario_id_fkey' AND conrelid = '"importacao_lotes"'::regclass) THEN
    ALTER TABLE "importacao_lotes" ADD CONSTRAINT "importacao_lotes_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'importacao_lotes_desfeito_por_id_fkey' AND conrelid = '"importacao_lotes"'::regclass) THEN
    ALTER TABLE "importacao_lotes" ADD CONSTRAINT "importacao_lotes_desfeito_por_id_fkey"
      FOREIGN KEY ("desfeito_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Os itens do lote
CREATE TABLE IF NOT EXISTS "importacao_lote_itens" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "registro_id" TEXT NOT NULL,
    "acao" "AcaoLoteItem" NOT NULL,
    "linha" INTEGER,
    "desfeito_em" TIMESTAMP(3),
    CONSTRAINT "importacao_lote_itens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "importacao_lote_itens_lote_id_idx" ON "importacao_lote_itens"("lote_id");
CREATE INDEX IF NOT EXISTS "importacao_lote_itens_empresa_id_entidade_registro_id_idx" ON "importacao_lote_itens"("empresa_id", "entidade", "registro_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'importacao_lote_itens_lote_id_fkey' AND conrelid = '"importacao_lote_itens"'::regclass) THEN
    ALTER TABLE "importacao_lote_itens" ADD CONSTRAINT "importacao_lote_itens_lote_id_fkey"
      FOREIGN KEY ("lote_id") REFERENCES "importacao_lotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
