-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Leva J — Colaborador. Aditivo e idempotente: pode rodar mais de uma vez sem mudar nada.
--
-- 1. A jornada em FAIXAS (ex.: Seg–Qui 07:30–17:30 com intervalo; Sex 07:30–16:30). Coluna nova, nula: quem já tem
--    jornada continua com os campos antigos (jornada_dias, jornada_entrada, jornada_saida), que o sistema lê como
--    uma faixa só. Nada é convertido nem apagado.
-- 2. "Mostrar especialidades do técnico" (Configurações › Impressão da OS): ligado por padrão em todas as empresas.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "jornada_faixas" JSONB;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "mostrar_especialidades_tecnico" BOOLEAN NOT NULL DEFAULT true;
