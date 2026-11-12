-- ACEITE DO CLIENTE — aviso no sino do escritório quando o cliente confirma (com ou sem ressalva).
--
-- O que entra (ADITIVO; nada é removido nem alterado):
--   "os_aceites"."visto_em": quando alguém do escritório (OS › Editar) abriu a OS depois da
--   confirmação. Vazio = o aviso ainda está no sino. É o mesmo mecanismo da NFS-e
--   ("aviso_visto_em") e da resposta do orçamento ("resposta_vista_em").
--
-- A RESSALVA do cliente NÃO precisa de coluna nova: usa a coluna "observacao" que já existe em
-- "os_aceites" (era o campo "Observação" da primeira versão da página de confirmação).
--
-- A coluna "configuracoes"."os_exigir_assinatura" (toggle que saiu da tela) NÃO é removida aqui:
-- fica no banco, sem uso, até uma limpeza combinada.
--
-- IDEMPOTENTE: IF NOT EXISTS. Pode rodar mais de uma vez. Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-29_os_aceite_visto.sql

ALTER TABLE "os_aceites" ADD COLUMN IF NOT EXISTS "visto_em" TIMESTAMP(3);
