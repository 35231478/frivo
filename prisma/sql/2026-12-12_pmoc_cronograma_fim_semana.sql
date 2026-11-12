-- PMOC — Etapa 2.1: fim de semana no cronograma.
--
-- "pmoc_cronogramas"."fim_semana": o que fazer quando o dia de execução do item cai em sábado ou
-- domingo — MANTER, ADIANTAR (sexta-feira) ou POSTERGAR (segunda-feira). É o MESMO tipo que a
-- recorrência de OS dos contratos já usa ("TratamentoFimSemana", já existe no banco): não cria enum
-- nem acrescenta valor a enum, por isso é um arquivo só (não precisa do padrão em dois passos).
--
-- NOT NULL com DEFAULT 'MANTER': os itens de cronograma que já existem continuam exatamente como
-- estão hoje (as OS já geradas não mudam de data). Nos itens novos, a tela propõe POSTERGAR.
--
-- ADITIVO e IDEMPOTENTE (ADD COLUMN IF NOT EXISTS; pode rodar mais de uma vez): UMA coluna nova numa
-- tabela do próprio PMOC. Nada é removido nem alterado. Não usa `prisma migrate`.
--
-- A SUBSTITUIÇÃO (no mês em que dois itens pegam o mesmo equipamento, vale o de maior intervalo) é
-- só regra da aplicação: não tem banco.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-12_pmoc_cronograma_fim_semana.sql

ALTER TABLE "pmoc_cronogramas" ADD COLUMN IF NOT EXISTS "fim_semana" "TratamentoFimSemana" NOT NULL DEFAULT 'MANTER';
