-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Portal do cliente: senha provisória segura (aditivo e idempotente: pode rodar mais de uma vez sem mudar nada)
--
-- contatos_cliente.trocar_senha = a senha deste contato veio da EQUIPE (provisória gerada pelo sistema ao
-- liberar o acesso ou em "Gerar nova senha provisória") e ele ainda não a trocou. Enquanto estiver
-- marcada, depois do login o portal só abre a tela de troca. Limpa quando o PRÓPRIO contato troca a senha
-- (na tela de troca ou pelo "Esqueci minha senha").
--
-- Todos os contatos que já existem ficam FALSE: quem já tem acesso continua entrando como hoje.
-- A coluna antiga `senha_provisoria` NÃO é tocada (nem apagada nem zerada): a limpeza fica documentada
-- para depois em docs/portal-senha-provisoria.md.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "contatos_cliente" ADD COLUMN IF NOT EXISTS "trocar_senha" BOOLEAN NOT NULL DEFAULT false;
