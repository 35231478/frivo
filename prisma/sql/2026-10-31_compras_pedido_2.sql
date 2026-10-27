-- Compras — Pedido de Compra completo (parte 2 de 2 do SQL). Rodar DEPOIS do passo 1
-- (2026-10-31_compras_pedido_1_enum.sql), em execução separada.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado.

-- 1) Pedido: data do status atual, fornecedor (para enviar o PC), motivo do avulso e link público
ALTER TABLE "pedidos_compra_interno" ADD COLUMN IF NOT EXISTS "status_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "pedidos_compra_interno" ADD COLUMN IF NOT EXISTS "fornecedor_id" TEXT;
ALTER TABLE "pedidos_compra_interno" ADD COLUMN IF NOT EXISTS "motivo" TEXT;
ALTER TABLE "pedidos_compra_interno" ADD COLUMN IF NOT EXISTS "token_publico" TEXT;

-- Pedidos que já existiam: status desde a última alteração; link público próprio de cada um
UPDATE "pedidos_compra_interno" SET "status_em" = "atualizado_em" WHERE "status_em" > "atualizado_em";
UPDATE "pedidos_compra_interno"
SET "token_publico" = md5("id" || random()::text || clock_timestamp()::text)
WHERE "token_publico" IS NULL;
ALTER TABLE "pedidos_compra_interno" ALTER COLUMN "token_publico" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "pedidos_compra_interno_token_publico_key" ON "pedidos_compra_interno"("token_publico");
CREATE INDEX IF NOT EXISTS "pedidos_compra_interno_fornecedor_id_idx" ON "pedidos_compra_interno"("fornecedor_id");

-- 2) Status legados viram o ciclo novo: Entregue → Concluída; Comprado (aguardando a NF) → Em cotação
UPDATE "pedidos_compra_interno" SET "status" = 'CONCLUIDO' WHERE "status" = 'ENTREGUE';
UPDATE "pedidos_compra_interno" SET "status" = 'COTANDO' WHERE "status" = 'COMPRADO';

-- 3) Histórico do pedido
CREATE TABLE IF NOT EXISTS "pedido_compra_eventos" (
  "id"         TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "pedido_id"  TEXT NOT NULL,
  "tipo"       TEXT NOT NULL,
  "detalhe"    TEXT,
  "usuario_id" TEXT,
  "criado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pedido_compra_eventos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pedido_compra_eventos_pedido_id_criado_em_idx" ON "pedido_compra_eventos"("pedido_id", "criado_em");
CREATE INDEX IF NOT EXISTS "pedido_compra_eventos_empresa_id_idx" ON "pedido_compra_eventos"("empresa_id");

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('pedidos_compra_interno', 'pedidos_compra_interno_fornecedor_id_fkey', 'FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('pedido_compra_eventos', 'pedido_compra_eventos_empresa_id_fkey', 'FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('pedido_compra_eventos', 'pedido_compra_eventos_pedido_id_fkey', 'FOREIGN KEY ("pedido_id") REFERENCES "pedidos_compra_interno"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('pedido_compra_eventos', 'pedido_compra_eventos_usuario_id_fkey', 'FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE')
  ) AS t(tabela, nome, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome AND conrelid = format('%I', fk.tabela)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tabela, fk.nome, fk.def);
    END IF;
  END LOOP;
END $$;

-- 4) Permissão nova "Compras" (ver + gerenciar): quem já via compras pelo Financeiro continua vendo.
-- Só nos perfis que ainda não têm a chave "compras" (rodar 2× não muda nada). Exige re-login.
UPDATE "perfis_acesso"
SET "permissoes" = jsonb_set("permissoes"::jsonb, '{compras}', '{"visualizar": true, "gerenciar": true}'::jsonb, true)
WHERE COALESCE(("permissoes"::jsonb -> 'financeiro' ->> 'visualizar')::boolean, false) = true
  AND NOT ("permissoes"::jsonb ? 'compras');

-- Perfis que já tinham uma chave "compras" antiga com "criar": no módulo novo isso é "gerenciar"
UPDATE "perfis_acesso"
SET "permissoes" = jsonb_set("permissoes"::jsonb, '{compras,gerenciar}', 'true'::jsonb, true)
WHERE COALESCE(("permissoes"::jsonb -> 'compras' ->> 'criar')::boolean, false) = true
  AND NOT (("permissoes"::jsonb -> 'compras') ? 'gerenciar');
