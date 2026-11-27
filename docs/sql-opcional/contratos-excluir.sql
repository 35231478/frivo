-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- OPCIONAL — "Contratos › Excluir" (cancelar contrato) para os perfis que JÁ podem editar contratos
--
-- Não faz parte do deploy e não está em prisma/sql de propósito: conceder privilégio é decisão do
-- responsável pela empresa, que roda (ou não) este arquivo ele mesmo.
--
-- Contexto: a partir desta versão, cancelar contrato exige a permissão própria "Contratos › Excluir"
-- (como cancelar OS e orçamento). Os perfis gravados antes não têm a chave, então quem cancelava com
-- "Contratos › Editar" deixa de poder cancelar (suspender, encerrar e reativar continuam iguais).
-- Administrador (role ADMIN) e super admin podem tudo, sem nada no banco.
--
-- O caminho recomendado é a tela: Configurações › Perfis de acesso › marcar "Contratos › Excluir"
-- em quem cancela contratos. Este SQL faz o mesmo para TODOS os perfis que hoje têm Contratos › Editar
-- (mantém o comportamento anterior). Quem já está logado recebe a permissão depois de sair e entrar.
--
-- Aditivo e idempotente: só acrescenta a chave onde ela falta; rodar de novo não muda nada; não mexe
-- em perfil que já tenha a chave gravada (true ou false).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;

UPDATE "perfis_acesso"
SET "permissoes" = jsonb_set("permissoes"::jsonb, '{contratos,excluir}', 'true'::jsonb, true)
WHERE jsonb_typeof("permissoes"::jsonb) = 'object'
  AND jsonb_typeof("permissoes"::jsonb -> 'contratos') = 'object'
  AND ("permissoes"::jsonb -> 'contratos' ->> 'editar') = 'true'
  AND NOT (("permissoes"::jsonb -> 'contratos') ? 'excluir');

COMMIT;

-- Conferir:
-- SELECT nome, tipo, permissoes->'contratos' FROM perfis_acesso ORDER BY tipo, nome;
