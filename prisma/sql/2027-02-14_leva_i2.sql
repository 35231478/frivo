-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- "Leva I.2" (as decisões do Zé sobre a varredura) — aditivo e idempotente: pode rodar mais de uma vez sem mudar nada.
--
--  - empresa_eventos: a trilha da empresa na área do dono do Frivo (dados editados pelo super admin, nova senha
--    provisória do 1º administrador);
--  - tabela_preco_reajustes: o reajuste em massa da tabela de preço (o lote: % ou valor, motivo, o antes e o depois
--    de cada item) — é dele que sai o "Desfazer reajuste";
--  - os_itens_orcamento: o material lançado em campo (app do técnico) que vira item cobrado na OS no modo "Cobrado à
--    parte", esperando a conferência do escritório antes de faturar;
--  - notas_compra_descartes: o XML da nota descartada (para "Restaurar") e quem restaurou.
--
-- Nenhuma linha que já existe muda (as colunas novas nascem nulas ou falsas). Nada é apagado. Nenhum perfil de acesso
-- é alterado.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- A trilha da empresa (área Empresas do dono do Frivo)
CREATE TABLE IF NOT EXISTS "empresa_eventos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "tipo" TEXT NOT NULL,
    "detalhe" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "empresa_eventos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "empresa_eventos_empresa_id_criado_em_idx" ON "empresa_eventos"("empresa_id", "criado_em");
DO $$ BEGIN
  ALTER TABLE "empresa_eventos" ADD CONSTRAINT "empresa_eventos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- O reajuste em massa da tabela de preço (um lote por aplicação; desfazer volta o antes de cada item)
CREATE TABLE IF NOT EXISTS "tabela_preco_reajustes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tabela_preco_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "tipo" TEXT NOT NULL,
    "valor" DECIMAL(12,4) NOT NULL,
    "motivo" TEXT NOT NULL,
    "itens" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desfeito_em" TIMESTAMP(3),
    "desfeito_por_id" TEXT,
    CONSTRAINT "tabela_preco_reajustes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tabela_preco_reajustes_empresa_id_tabela_preco_id_criado_em_idx" ON "tabela_preco_reajustes"("empresa_id", "tabela_preco_id", "criado_em");
DO $$ BEGIN
  ALTER TABLE "tabela_preco_reajustes" ADD CONSTRAINT "tabela_preco_reajustes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "tabela_preco_reajustes" ADD CONSTRAINT "tabela_preco_reajustes_tabela_preco_id_fkey" FOREIGN KEY ("tabela_preco_id") REFERENCES "tabelas_preco"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- O material de campo cobrado à parte: o item da OS que nasce dele, e a conferência do escritório
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "material_campo_id" TEXT;
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "conferir_campo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "conferido_campo_em" TIMESTAMP(3);
ALTER TABLE "os_itens_orcamento" ADD COLUMN IF NOT EXISTS "conferido_campo_por_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "os_itens_orcamento_material_campo_id_key" ON "os_itens_orcamento"("material_campo_id");
DO $$ BEGIN
  ALTER TABLE "os_itens_orcamento" ADD CONSTRAINT "os_itens_orcamento_material_campo_id_fkey" FOREIGN KEY ("material_campo_id") REFERENCES "atividade_materiais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A nota descartada pode ser restaurada: o XML dela fica no registro do descarte
ALTER TABLE "notas_compra_descartes" ADD COLUMN IF NOT EXISTS "xml" TEXT;
ALTER TABLE "notas_compra_descartes" ADD COLUMN IF NOT EXISTS "restaurada_em" TIMESTAMP(3);
ALTER TABLE "notas_compra_descartes" ADD COLUMN IF NOT EXISTS "restaurada_por_id" TEXT;
ALTER TABLE "notas_compra_descartes" ADD COLUMN IF NOT EXISTS "nota_restaurada_id" TEXT;
