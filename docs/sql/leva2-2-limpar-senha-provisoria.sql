-- Leva 2 (C2) — LIMPEZA OPCIONAL, rode DEPOIS do deploy.
-- O código novo não lê nem grava mais a senha do portal em texto (coluna senha_provisoria);
-- o login usa só o hash (coluna senha), que NÃO é tocado aqui. Esta limpeza apaga as cópias
-- em texto que ficaram de antes. Ninguém perde acesso ao portal.
-- Efeito colateral: o gestor não consegue mais "ver" senhas antigas — para repassar a um
-- contato, use "Redefinir senha" na aba Portal do cliente.

-- 1) Quantas serão limpas (somente leitura):
SELECT COUNT(*) AS contatos_com_senha_em_texto
FROM contatos_cliente
WHERE senha_provisoria IS NOT NULL;

-- 2) Limpeza (idempotente):
UPDATE contatos_cliente SET senha_provisoria = NULL WHERE senha_provisoria IS NOT NULL;
