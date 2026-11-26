-- ORÇAMENTO, LEVA D — opções do documento do cliente: "Mostrar materiais ao cliente" e "Mostrar valores dos
-- produtos/materiais" (link do cliente, impressão e PDF — os três iguais).
--
-- 🔵 PENDENTE — aplicar ANTES de subir o código desta leva (o Prisma passa a ler estas colunas).
--
-- O LEVANTAMENTO (o que já existia):
--   • "orcamento_materiais" já guarda, por serviço do orçamento, cada material com o preço de venda
--     ("valor_venda_unit") e o custo ("custo_unit"). O documento do cliente nunca os mostrava.
--   • "configuracoes" guarda os padrões do orçamento novo em colunas próprias (validade, garantias, não
--     incluso, normas) e cada orçamento grava os seus. Nenhuma coluna servia para as duas opções.
--
-- O QUE ENTRA (ADITIVO; nada é removido, alterado ou preenchido):
--   1. "orcamentos"."mostrar_materiais" e "orcamentos"."mostrar_valores_materiais" (boolean, NOT NULL,
--      DEFAULT false): as opções DESTE orçamento. Valores só valem com materiais ligado (regra no código).
--   2. "configuracoes"."orcamento_mostrar_materiais" e "configuracoes"."orcamento_mostrar_valores_materiais"
--      (boolean, NOT NULL, DEFAULT false): o padrão da empresa, copiado para cada orçamento NOVO.
--
-- O QUE NÃO MUDA:
--   • DEFAULT false = como hoje: o cliente vê só a linha do serviço. Orçamentos e empresas que já existem
--     ficam desligados (o documento já enviado continua igual). Sem preenchimento retroativo.
--   • O custo ("custo_unit") NUNCA vai para o documento: as opções só mostram o preço de venda.
--
-- Sem tabela nova, sem chave estrangeira, sem enum, sem índice. Pode rodar mais de uma vez.

ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "mostrar_materiais" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "mostrar_valores_materiais" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "orcamento_mostrar_materiais" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "orcamento_mostrar_valores_materiais" BOOLEAN NOT NULL DEFAULT false;

-- Conferir:
-- SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
--  WHERE (table_name = 'orcamentos' AND column_name LIKE 'mostrar_%')
--     OR (table_name = 'configuracoes' AND column_name LIKE 'orcamento_mostrar_%');
