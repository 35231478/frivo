# App do técnico — e-mail de login somente leitura em Meus dados

🟢 **Sem mudança de banco. O painel não muda.**

## O problema

O técnico é ligado às OS dele **pelo e-mail de login** (no login, o sistema procura o colaborador com
o mesmo e-mail). Em Meus dados, no app, ele conseguia trocar esse e-mail. Trocando, o vínculo se
perdia: o app abria sem nenhuma OS até o escritório acertar o cadastro.

## O que mudou

**No app (Perfil › Meus dados › Dados pessoais):**

- O campo passa a se chamar **"E-mail de login"**, mostra o e-mail e é **somente leitura**.
- Embaixo dele, uma linha: **"A troca do e-mail de login é feita pelo escritório."**
- Os campos "Confirmar e-mail" e "Senha atual" (que apareciam ao mudar o e-mail) não existem mais ali.
- **Nome e foto continuam editáveis.** Ao salvar o nome, o e-mail nem vai no pedido.

**No servidor (`PATCH /api/perfil`):**

- A rota **recusa (403)** a troca de e-mail de quem está no **modo técnico**, com a mensagem
  "O e-mail de login é trocado pelo escritório, na ficha do colaborador." Nada é gravado — nem o
  nome que veio junto.
- **Decisão minha, confira:** a tela travada sozinha não é trava (dava para chamar a rota direto com a
  sessão do técnico). Por isso a regra está também no servidor. Ela só alcança quem está no modo
  técnico — que não entra no painel —, então o painel segue igual.
- App antigo guardado no aparelho (que manda o mesmo e-mail junto do nome) continua salvando o nome.

**Quem é "modo técnico"** (a regra que já existia, `emModoTecnico`): o papel TECNICO, e quem tem só as
permissões de técnico e está ligado a um colaborador. Administrador que também é técnico usa o painel
e **não** é barrado.

## Quem troca o e-mail de login do técnico

O escritório, pela **ficha do colaborador**: ao mudar o e-mail lá, o login do app é renomeado junto
(código que já existia em `app/api/tecnicos/[id]/route.ts`; não mexi).

## O painel não muda

"Meu perfil" do painel continua com o e-mail editável, pedindo confirmação e senha atual ao mudar. O
componente é o mesmo (`PerfilClient`); a trava é um parâmetro (`emailSomenteLeitura`) que só o app liga.

## Arquivos

- `components/perfil/perfil-client.tsx` — parâmetro `emailSomenteLeitura` (padrão: desligado)
- `components/tecnico/perfil.tsx` — o app liga o parâmetro
- `app/api/perfil/route.ts` — recusa a troca no modo técnico
- `lib/tecnico/modo.ts` — a mensagem

## Testes — `tecnico-email-login` (15)

- **Servidor (8):** papel TECNICO recusado mesmo com confirmação e senha certas; nada gravado, nem o
  nome; técnico por perfil também recusado; nome continua editável; app antigo com o mesmo e-mail;
  administrador e operador continuam trocando no painel; administrador que também é técnico não é
  barrado; a ficha do colaborador leva o login junto.
- **Tela do app (5):** campo somente leitura com a linha explicativa; digitar não muda nada e os
  campos de troca não aparecem; nome salva pela rota real sem e-mail no corpo; foto continua
  editável; alvo de 44 px.
- **Tela do painel (2):** e-mail editável como antes; o corpo enviado é o de sempre e a troca acontece.

## Conferido no navegador (app real)

- No app: campo `readOnly`, 44 px de altura, mostrando o e-mail do técnico.
- Tentativa direta na rota com a sessão do técnico (com confirmação e a senha certa): **403**, e o
  e-mail no banco não mudou.
- No painel: campo editável, sem a trava.

## Prints

`docs/prints/tecnico-email-login-somente-leitura/` (desktop e celular): Meus dados no app e Meu perfil
no painel.
