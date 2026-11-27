-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- "Troca de senha no 1º acesso" (aditivo e idempotente: pode rodar mais de uma vez sem mudar nada)
--
-- usuarios.trocar_senha = a senha deste usuário foi definida por OUTRA pessoa e ele ainda não a trocou.
-- Marcada pelo sistema quando:
--   - o super admin cria a empresa com o 1º administrador (tela Empresas);
--   - a empresa libera ou redefine o acesso ao app na ficha do colaborador (senha definida pelo gestor).
-- Limpa quando a PRÓPRIA pessoa troca a senha (Meu perfil, Meus dados do app, link de convite ou
-- "Esqueci minha senha"). Enquanto estiver marcada, depois do login o sistema só abre a tela de troca.
--
-- Todos os usuários que já existem ficam FALSE: nenhum é obrigado a trocar com este SQL (ver o PR).
-- Nada é apagado.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "trocar_senha" BOOLEAN NOT NULL DEFAULT false;
