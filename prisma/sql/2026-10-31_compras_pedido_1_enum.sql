-- Compras — Pedido de Compra completo (parte 1 de 2 do SQL): novos valores do status.
-- PASSO 1 DE 2. Rodar ANTES do passo 2, em execução SEPARADA: no PostgreSQL um valor novo de enum
-- só pode ser USADO depois que o comando que o criou terminou (o passo 2 usa CONCLUIDO).
-- ADITIVO e IDEMPOTENTE (IF NOT EXISTS): pode rodar 2× sem efeito extra.
ALTER TYPE "StatusPedidoCompra" ADD VALUE IF NOT EXISTS 'PARCIAL';
ALTER TYPE "StatusPedidoCompra" ADD VALUE IF NOT EXISTS 'CONCLUIDO';
