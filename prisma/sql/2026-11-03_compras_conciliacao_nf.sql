-- Compras 2/2 — Conciliação NF ↔ Pedido de Compra (vínculo POR ITEM).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado. Sem enum novo
-- (PARCIAL e CONCLUIDO já vieram no SQL do Compras 1/2).

-- 1) Pedido: aviso ao solicitante de que chegou NF (o sino acende enquanto "nf_vista_em" estiver vazio)
ALTER TABLE "pedidos_compra_interno" ADD COLUMN IF NOT EXISTS "nf_vinculada_em" TIMESTAMP(3);
ALTER TABLE "pedidos_compra_interno" ADD COLUMN IF NOT EXISTS "nf_vista_em" TIMESTAMP(3);

-- 2) Vínculo item da NF ↔ item do pedido (quantidade e custo real na unidade do produto)
CREATE TABLE IF NOT EXISTS "pedido_compra_vinculos" (
  "id"                  TEXT NOT NULL,
  "empresa_id"          TEXT NOT NULL,
  "pedido_id"           TEXT NOT NULL,
  "pedido_item_id"      TEXT NOT NULL,
  "nota_id"             TEXT NOT NULL,
  "nota_item_id"        TEXT NOT NULL,
  "quantidade"          DECIMAL(15,4) NOT NULL,
  "valor_unitario"      DECIMAL(15,4) NOT NULL,
  "valor_real_anterior" DECIMAL(12,2),
  "criterio"            TEXT NOT NULL DEFAULT 'PRODUTO',
  "automatico"          BOOLEAN NOT NULL DEFAULT false,
  "usuario_id"          TEXT,
  "criado_em"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pedido_compra_vinculos_pkey" PRIMARY KEY ("id")
);
-- Vincular 2× o mesmo item da NF ao mesmo item do pedido não duplica
CREATE UNIQUE INDEX IF NOT EXISTS "pedido_compra_vinculos_pedido_item_id_nota_item_id_key" ON "pedido_compra_vinculos"("pedido_item_id", "nota_item_id");
CREATE INDEX IF NOT EXISTS "pedido_compra_vinculos_nota_id_idx" ON "pedido_compra_vinculos"("nota_id");
CREATE INDEX IF NOT EXISTS "pedido_compra_vinculos_pedido_id_idx" ON "pedido_compra_vinculos"("pedido_id");
CREATE INDEX IF NOT EXISTS "pedido_compra_vinculos_empresa_id_idx" ON "pedido_compra_vinculos"("empresa_id");

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('pedido_compra_vinculos_empresa_id_fkey', 'FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('pedido_compra_vinculos_pedido_id_fkey', 'FOREIGN KEY ("pedido_id") REFERENCES "pedidos_compra_interno"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('pedido_compra_vinculos_pedido_item_id_fkey', 'FOREIGN KEY ("pedido_item_id") REFERENCES "pedidos_compra_item"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('pedido_compra_vinculos_nota_id_fkey', 'FOREIGN KEY ("nota_id") REFERENCES "notas_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('pedido_compra_vinculos_nota_item_id_fkey', 'FOREIGN KEY ("nota_item_id") REFERENCES "notas_compra_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('pedido_compra_vinculos_usuario_id_fkey', 'FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE')
  ) AS t(nome, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome AND conrelid = '"pedido_compra_vinculos"'::regclass) THEN
      EXECUTE format('ALTER TABLE "pedido_compra_vinculos" ADD CONSTRAINT %I %s', fk.nome, fk.def);
    END IF;
  END LOOP;
END $$;
