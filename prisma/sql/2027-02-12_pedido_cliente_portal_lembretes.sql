-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- "Pedido do cliente no portal + lembretes" (PC-2) — aditivo e idempotente: pode rodar mais de uma vez.
-- Depende do SQL da PC-1 (2027-02-11_pedido_cliente.sql), que cria pedidos_cliente.
--
-- 1. O comprador do cliente anexa o "Pedido de compra" no portal. Ele entra em pedidos_cliente com
--    origem 'PORTAL' e situação 'CONFERIR', sem ligar nenhuma OS: as OS que ele disse cobrir ficam em
--    os_propostas / orcamentos_propostos até o escritório CONFIRMAR (aí liga e libera o faturamento) ou
--    RECUSAR (com o motivo, que o cliente vê).
--    Todo pedido que já existe nasce 'ESCRITORIO' / 'CONFIRMADO': nada muda para ele.
-- 2. Lembretes por e-mail ao contato de compras: a régua da empresa (padrão 3, 7 e 15 dias, desligável) e a
--    chave por cliente (padrão ligado). Cada lembrete enviado fica em pedidos_cliente_lembretes; a chave
--    única impede repetir a mesma etapa para o mesmo item.
--
-- Nada é apagado nem atualizado. Nenhum perfil de acesso muda.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- O pedido que vem do portal
ALTER TABLE "pedidos_cliente" ADD COLUMN IF NOT EXISTS "origem" TEXT NOT NULL DEFAULT 'ESCRITORIO';
ALTER TABLE "pedidos_cliente" ADD COLUMN IF NOT EXISTS "situacao" TEXT NOT NULL DEFAULT 'CONFIRMADO';
ALTER TABLE "pedidos_cliente" ADD COLUMN IF NOT EXISTS "os_propostas" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "pedidos_cliente" ADD COLUMN IF NOT EXISTS "orcamentos_propostos" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "pedidos_cliente" ADD COLUMN IF NOT EXISTS "enviado_por_contato_id" TEXT;
ALTER TABLE "pedidos_cliente" ADD COLUMN IF NOT EXISTS "conferido_em" TIMESTAMP(3);
ALTER TABLE "pedidos_cliente" ADD COLUMN IF NOT EXISTS "conferido_por_id" TEXT;
ALTER TABLE "pedidos_cliente" ADD COLUMN IF NOT EXISTS "motivo_recusa" TEXT;
CREATE INDEX IF NOT EXISTS "pedidos_cliente_empresa_id_situacao_idx" ON "pedidos_cliente"("empresa_id", "situacao");

-- A régua dos lembretes (Configurações) e a chave por cliente
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "pedido_lembretes_ativo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "pedido_lembretes_dias" INTEGER[] DEFAULT ARRAY[3, 7, 15]::INTEGER[];
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "pedido_lembretes_ativo" BOOLEAN NOT NULL DEFAULT true;

-- Cada lembrete enviado (por item e etapa)
CREATE TABLE IF NOT EXISTS "pedidos_cliente_lembretes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "ordem_servico_id" TEXT,
    "orcamento_id" TEXT,
    "etapa" INTEGER NOT NULL,
    "chave" TEXT NOT NULL,
    "envio" TEXT NOT NULL,
    "para" TEXT NOT NULL,
    "enviado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pedidos_cliente_lembretes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "pedidos_cliente_lembretes_chave_key" ON "pedidos_cliente_lembretes"("chave");
CREATE INDEX IF NOT EXISTS "pedidos_cliente_lembretes_empresa_id_ordem_servico_id_idx" ON "pedidos_cliente_lembretes"("empresa_id", "ordem_servico_id");
CREATE INDEX IF NOT EXISTS "pedidos_cliente_lembretes_empresa_id_orcamento_id_idx" ON "pedidos_cliente_lembretes"("empresa_id", "orcamento_id");
DO $$ BEGIN
  ALTER TABLE "pedidos_cliente_lembretes" ADD CONSTRAINT "pedidos_cliente_lembretes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
