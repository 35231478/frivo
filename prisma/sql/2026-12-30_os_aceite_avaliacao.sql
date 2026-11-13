-- ACEITE DO CLIENTE — AVALIAÇÃO do serviço: nota de 1 a 5 estrelas + comentário opcional.
--
-- O que entra (tudo ADITIVO; nada é removido nem alterado):
--   1. "os_aceites"."avaliacao": a nota do cliente, de 1 a 5. Vazio = confirmou sem avaliar (a
--      avaliação é opcional e nunca trava a confirmação).
--   2. "os_aceites"."avaliacao_comentario": o comentário da avaliação. É separado da RESSALVA, que
--      continua na coluna "observacao".
--   3. Uma regra de integridade em "os_aceites": a nota, quando existe, é de 1 a 5 (o dado alimenta
--      o módulo de Desempenho: nota fora da faixa não entra nem por engano).
--   4. "configuracoes"."aceite_pedir_avaliacao": a opção por empresa "Pedir avaliação do cliente".
--      Nasce LIGADA (true), inclusive nas empresas que já existem.
--
-- A nota fica ligada à OS ("os_aceites"."ordem_servico_id") e, por ela, aos técnicos que executaram
-- (as atividades da OS: "atividades_os"."tecnico_id" e "atividade_tecnicos"). Não precisa de tabela nova.
--
-- Os aceites que já existem ficam como estão: sem nota e sem comentário.
--
-- IDEMPOTENTE: IF NOT EXISTS nas colunas; a regra só é criada quando ainda não existe. Pode rodar mais
-- de uma vez. Sem enum. Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-30_os_aceite_avaliacao.sql

BEGIN;

ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "aceite_pedir_avaliacao" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "os_aceites" ADD COLUMN IF NOT EXISTS "avaliacao" INTEGER;
ALTER TABLE "os_aceites" ADD COLUMN IF NOT EXISTS "avaliacao_comentario" TEXT;

DO $$
DECLARE
  tabela CONSTANT regclass := to_regclass('"os_aceites"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'os_aceites_avaliacao_check' AND conrelid = tabela) THEN
    ALTER TABLE "os_aceites" ADD CONSTRAINT "os_aceites_avaliacao_check"
      CHECK ("avaliacao" IS NULL OR "avaliacao" BETWEEN 1 AND 5);
  END IF;
END $$;

COMMIT;
