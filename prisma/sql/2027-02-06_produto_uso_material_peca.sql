-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- "Orçamento E — Material × Peça" (aditivo e idempotente: pode rodar mais de uma vez sem mudar nada)
--
-- 1. produtos.uso: MATERIAL (consumo, vai dentro do serviço, sem valor para o cliente) | PECA (vendida à parte,
--    em linha própria com valor). Os produtos que já existem recebem o Uso pela ORIGEM MAIS USADA:
--      - como MATERIAL: composição de serviço (servico_materiais), kit (kit_material_itens), material incluso
--        no orçamento (orcamento_materiais) e na OS (os_materiais);
--      - como PEÇA: linha de produto avulsa no orçamento (orcamento_produtos sem material) e na OS
--        (os_itens_orcamento sem material), material "venda à parte" no orçamento e na OS;
--      - empate (inclusive nunca usado): o comportamento da categoria (Peças de reposição = PECA); sem
--        categoria, MATERIAL.
--    O preenchimento só toca linha com uso NULO: rodar de novo não desfaz uma escolha feita depois no cadastro.
-- 2. O documento do cliente passa a mostrar os materiais dentro do serviço POR PADRÃO (empresas e orçamentos
--    NOVOS). Os valores já gravados não mudam (ver o bloco opcional 3).
-- Nenhuma coluna é apagada: orcamento_mostrar_valores_materiais / mostrar_valores_materiais ficam (sem uso na tela).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1a. O tipo
DO $$ BEGIN
  CREATE TYPE "UsoProduto" AS ENUM ('MATERIAL', 'PECA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1b. A coluna (nula enquanto preenche)
ALTER TABLE "produtos" ADD COLUMN IF NOT EXISTS "uso" "UsoProduto";

-- 1c. O preenchimento pela origem mais usada (só onde ainda está nulo)
WITH usos AS (
  SELECT p.id,
    (SELECT count(*) FROM "servico_materiais" sm WHERE sm.produto_id = p.id)
    + (SELECT count(*) FROM "kit_material_itens" ki WHERE ki.produto_id = p.id)
    + (SELECT count(*) FROM "orcamento_materiais" om WHERE om.produto_id = p.id AND om.comportamento = 'INCLUSO_NO_SERVICO')
    + (SELECT count(*) FROM "os_materiais" osm WHERE osm.produto_id = p.id AND osm.comportamento = 'INCLUSO_NO_SERVICO') AS como_material,
    (SELECT count(*) FROM "orcamento_produtos" op WHERE op.produto_id = p.id AND op.material_id IS NULL)
    + (SELECT count(*) FROM "os_itens_orcamento" oi WHERE oi.produto_id = p.id AND oi.material_id IS NULL)
    + (SELECT count(*) FROM "orcamento_materiais" om WHERE om.produto_id = p.id AND om.comportamento = 'VENDA_A_PARTE')
    + (SELECT count(*) FROM "os_materiais" osm WHERE osm.produto_id = p.id AND osm.comportamento = 'VENDA_A_PARTE') AS como_peca,
    (SELECT c.comportamento::text FROM "categorias_produto" c WHERE c.id = p.categoria_produto_id) AS da_categoria
  FROM "produtos" p
  WHERE p."uso" IS NULL
)
UPDATE "produtos" p SET "uso" = (
  CASE
    WHEN u.como_peca > u.como_material THEN 'PECA'
    WHEN u.como_material > u.como_peca THEN 'MATERIAL'
    WHEN u.da_categoria = 'VENDA_A_PARTE' THEN 'PECA'
    ELSE 'MATERIAL'
  END
)::"UsoProduto"
FROM usos u
WHERE u.id = p.id AND p."uso" IS NULL;

-- 1d. Padrão e obrigatório (depois de preenchido)
ALTER TABLE "produtos" ALTER COLUMN "uso" SET DEFAULT 'MATERIAL';
UPDATE "produtos" SET "uso" = 'MATERIAL' WHERE "uso" IS NULL;
ALTER TABLE "produtos" ALTER COLUMN "uso" SET NOT NULL;

-- 2. Materiais visíveis ao cliente por padrão (o que nasce daqui em diante)
ALTER TABLE "configuracoes" ALTER COLUMN "orcamento_mostrar_materiais" SET DEFAULT true;
ALTER TABLE "orcamentos" ALTER COLUMN "mostrar_materiais" SET DEFAULT true;

-- 3. OPCIONAL (decisão do Zé, por isso comentado): ligar também nas empresas que já existem, para os
--    orçamentos novos delas. Não mexe em orçamento já criado.
-- UPDATE "configuracoes" SET "orcamento_mostrar_materiais" = true WHERE "orcamento_mostrar_materiais" = false;
