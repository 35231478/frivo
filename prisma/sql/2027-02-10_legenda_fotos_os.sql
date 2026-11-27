-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- "Legenda da foto editável" na aba Relatórios da OS (aditivo e idempotente: pode rodar mais de uma vez)
--
-- As fotos enviadas à OS (os_anexos) já têm legenda. As fotos da EXECUÇÃO (checklist, antes/depois) e as
-- dos SERVIÇOS ADICIONAIS não tinham: a legenda era montada pelo sistema ("Antes do serviço",
-- "Checklist: …", "Serviço adicional: …"). Estas colunas guardam a legenda escrita por alguém; nula =
-- continua a legenda do sistema. Quem mudou, de quê para quê, fica no histórico da OS.
--
-- Nenhuma linha muda com este SQL (as colunas nascem nulas). Nada é apagado.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "fotos_atendimento" ADD COLUMN IF NOT EXISTS "legenda" TEXT;
ALTER TABLE "servicos_adicionais_fotos" ADD COLUMN IF NOT EXISTS "legenda" TEXT;
