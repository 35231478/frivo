# App do técnico — Trocar senha no Perfil (Tema 2)

> **Atualização:** o card "Trocar senha" solto no Perfil foi **removido** — a mesma função existia em
> dois lugares. A troca de senha do app vive agora **só em Perfil › Meus dados › Segurança** (mesma
> rota, mesmas regras). Ver `docs/tecnico-senha-unica-haptico.md`. O texto abaixo é o registro do Tema 2.

**Sem mudança de banco. A autenticação não foi alterada.**

## Levantamento — o que já existia
- **A rota `/api/perfil/senha` já existia** e já fazia tudo o que foi pedido: troca só a PRÓPRIA senha
  (o usuário vem da sessão; qualquer id no corpo é recusado), exige a senha atual (com bloqueio de
  15 min depois de 5 erros), aplica a regra de senha forte do sistema (8+ caracteres, letra e número)
  e guarda só o hash bcrypt. As outras sessões caem; a atual continua.
- **O app já chegava nela**, mas escondido: Perfil › "Meus dados e senha" › aba "Segurança" (a tela
  do painel embutida no app).

## O que foi criado
- **Seção "Trocar senha" direta no Perfil do app** (`components/tecnico/trocar-senha.tsx`): senha
  atual, nova (requisitos ao vivo) e confirmação; campos grandes, toque ≥44px; valida antes de
  enviar com a mesma regra do servidor; mostra o motivo quando o servidor recusa; sem sinal, explica
  e não envia (senha nunca entra na fila do aparelho).
- "Meus dados e senha" passou a se chamar **"Meus dados"** (a tela embutida continua igual).

## Pergunta para o Zé (não mexi)
- Em "Meus dados" o técnico também consegue **trocar o próprio e-mail de login**. O vínculo
  técnico ↔ usuário do app é pelo e-mail: se ele trocar, pode perder o acesso às OS até o cadastro
  do colaborador ser acertado. Quer que eu esconda a troca de e-mail no app do técnico?

## Testes
`tecnico-trocar-senha` (9 casos): a rota real com papel TECNICO (hash bcrypt, só a própria, força
mínima, senha atual, sem sessão) e a tela (está no Perfil, valida antes de enviar, corpo enviado,
erro do servidor, sem sinal, fluxo tela → rota).

## Prints
`docs/prints/tecnico-trocar-senha/` — celular (01 a 05) e desktop (06).
