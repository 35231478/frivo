-- Leva 2 (C3) — CONSULTA SOMENTE LEITURA. Rode ANTES do merge.
-- Depois do deploy, usuário que não é ADMIN e está SEM perfil de acesso (ou com perfil
-- inativo) passa a NÃO ter acesso a nada além do início. Antes, isso dava acesso total.
-- Esta consulta lista quem será afetado, para você atribuir um perfil antes do merge
-- (Configurações → Usuários) ou conscientemente deixar sem acesso.
SELECT u.nome,
       u.email,
       u.role,
       e."nomeFantasia"                      AS empresa,
       COALESCE(p.nome, '(sem perfil)')      AS perfil_atual,
       CASE WHEN p.id IS NULL THEN 'SEM PERFIL' ELSE 'PERFIL INATIVO' END AS situacao,
       u.ultimo_acesso
FROM usuarios u
JOIN empresas e            ON e.id = u.empresa_id
LEFT JOIN perfis_acesso p  ON p.id = u.perfil_acesso_id
WHERE u.ativo = true
  AND u.role <> 'ADMIN'
  AND (p.id IS NULL OR p.ativo = false)
ORDER BY e."nomeFantasia", u.nome;
