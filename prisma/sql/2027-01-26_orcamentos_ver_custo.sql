-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Orçamento, leva B — permissão nova "Orçamentos › Ver custo e margem" (orcamentos.verCusto)
--
-- 🔵 PENDENTE — OPCIONAL. NÃO precisa para o merge nem para o sistema funcionar:
--   • o usuário com role ADMIN (administrador master) já vê o custo sem nada no banco;
--   • todo perfil SEM a chave fica SEM a permissão (o padrão seguro: custo escondido).
-- Serve só para os perfis do tipo ADMINISTRADOR que JÁ existem: o preset novo de Administrador já
-- traz a permissão, mas os perfis gravados antes não têm a chave. Também dá para marcar na tela
-- Configurações → Perfis de acesso. Quem já está logado só recebe a permissão depois de sair e entrar.
--
-- Aditivo e idempotente: só ACRESCENTA a chave onde ela falta; rodar de novo não muda nada; não mexe
-- em perfil de outro tipo nem em permissão que já esteja gravada (true ou false).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;

UPDATE "perfis_acesso"
SET "permissoes" = jsonb_set("permissoes"::jsonb, '{orcamentos,verCusto}', 'true'::jsonb, true)
WHERE "tipo" = 'ADMINISTRADOR'
  AND jsonb_typeof("permissoes"::jsonb) = 'object'
  AND jsonb_typeof("permissoes"::jsonb -> 'orcamentos') = 'object'
  AND NOT (("permissoes"::jsonb -> 'orcamentos') ? 'verCusto');

COMMIT;

-- Conferir:
-- SELECT nome, tipo, permissoes->'orcamentos' FROM perfis_acesso ORDER BY tipo, nome;
