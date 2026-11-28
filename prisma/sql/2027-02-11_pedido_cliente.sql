-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- "Pedido do cliente" (PC-1) — aditivo e idempotente: pode rodar mais de uma vez sem mudar nada.
--
-- Clientes corporativos só pagam com o PEDIDO deles. A ficha do cliente diz se ele exige o pedido:
--   Não | Para faturar | Para executar e faturar.
-- "Para faturar" é a coluna que já existe (clientes.exige_pc_antes_nf): quem já estava marcado continua
-- valendo. "Para executar" é a coluna nova exige_pedido_executar. A unidade pode ter um modo próprio
-- (unidades.exige_pedido: NULL = como o cliente).
--
-- O pedido do cliente fica numa tabela nova (pedidos_cliente): um pedido cobre várias OS e orçamentos do
-- mesmo cliente (ordens_servico.pedido_cliente_id e orcamentos.pedido_cliente_id). A liberação sem pedido
-- (permissão "Liberar sem pedido do cliente", com motivo) fica na OS/orçamento e no histórico.
--
-- Nenhuma linha que já existe muda com este SQL (as colunas novas nascem nulas ou falsas; o prazo do aviso
-- nasce em 7 dias). Nada é apagado. Nenhum perfil de acesso é alterado: a permissão nova vale só para o
-- administrador até alguém marcá-la num perfil.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- O modo do cliente e o contato de compras
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "exige_pedido_executar" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "compras_nome" TEXT;
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "compras_email" TEXT;
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "compras_telefone" TEXT;

-- O modo da unidade (NULL = como o cliente)
ALTER TABLE "unidades" ADD COLUMN IF NOT EXISTS "exige_pedido" TEXT;

-- O pedido do cliente
CREATE TABLE IF NOT EXISTS "pedidos_cliente" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(12,2),
    "observacao" TEXT,
    "anexo" TEXT,
    "anexo_nome" TEXT,
    "anexo_tipo" TEXT,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pedidos_cliente_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pedidos_cliente_empresa_id_cliente_id_idx" ON "pedidos_cliente"("empresa_id", "cliente_id");
DO $$ BEGIN
  ALTER TABLE "pedidos_cliente" ADD CONSTRAINT "pedidos_cliente_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pedidos_cliente" ADD CONSTRAINT "pedidos_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A OS: o pedido e a liberação sem pedido
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pedido_cliente_id" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pedido_liberado_em" TIMESTAMP(3);
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pedido_liberado_por_id" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pedido_liberado_motivo" TEXT;
CREATE INDEX IF NOT EXISTS "ordens_servico_pedido_cliente_id_idx" ON "ordens_servico"("pedido_cliente_id");
DO $$ BEGIN
  ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_pedido_cliente_id_fkey" FOREIGN KEY ("pedido_cliente_id") REFERENCES "pedidos_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- O orçamento: o pedido e a liberação sem pedido
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "pedido_cliente_id" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "pedido_liberado_em" TIMESTAMP(3);
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "pedido_liberado_por_id" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "pedido_liberado_motivo" TEXT;
CREATE INDEX IF NOT EXISTS "orcamentos_pedido_cliente_id_idx" ON "orcamentos"("pedido_cliente_id");
DO $$ BEGIN
  ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_pedido_cliente_id_fkey" FOREIGN KEY ("pedido_cliente_id") REFERENCES "pedidos_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- O aviso do sino: depois de quantos dias esperando (Configurações)
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "pedido_cliente_dias_alerta" INTEGER NOT NULL DEFAULT 7;
