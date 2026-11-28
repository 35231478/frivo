# Hotfix: comentários do app no escritório e push que não chega

O Zé testou em produção (28/11, 02:27–02:30 UTC, OS-4442):

- **(A)** os comentários do **escritório** chegavam ao app; os do **técnico** não apareciam no escritório;
- **(B)** nenhuma notificação push chegava: nem o "Enviar teste", nem comentário, nem OS nova. Mesmo assim havia
  linhas em `push_envios` e 3 inscrições em `push_subscriptions`.

> 🔵 **Banco: NÃO aplicado.** O SQL está em `prisma/sql/2027-02-13_push_resultado_por_aparelho.sql`. Ele é aditivo e
> idempotente, e o Zé aplica antes do merge.
>
> **Produção não foi consultada.** O diagnóstico abaixo vem do código e de testes com dados fictícios. A rota de
> diagnóstico (abaixo) dá a resposta exata de produção em 1 minuto.

## (A) Comentários: o que estava errado

A hipótese era um filtro `atividade_id IS NULL`. **Ele não existe.** A rota do escritório (`GET
/api/ordens/[id]/comentarios`) já lia todos os comentários da OS, de todas as atividades. O teste do PostgreSQL real
(`app-campo-leva2-pg`) cobria exatamente isso e passava.

O defeito estava na **tela**:

- A conversa era lida **uma vez**, ao abrir a OS. O que o técnico escrevia depois só aparecia recarregando a página.
  Com a OS aberta enquanto o técnico escrevia (o teste do Zé), nada aparecia.
- Qualquer erro da leitura (403, 500, rede) virava **"Nenhum comentário"**. Uma falha ficava igual a "não tem nada".

**Agora:**

- a conversa **atualiza sozinha a cada 20 s** com a aba visível, e ao voltar para a aba;
  - com a aba escondida, ela não lê nem marca como lido;
- cada comentário do app mostra **a atividade** de onde veio ("Atividade: Limpeza dos splits");
- o que chegou depois da última leitura da pessoa aparece como **novo**;
- o **erro aparece como erro**;
- o sino continua contando as OS com comentário do app não lido (já contava `origem = APP`).

Se, mesmo assim, os comentários do app **não aparecerem depois de recarregar** a OS-4442, o problema é outro (ex.: a
sessão do escritório em modo técnico recebe 403). Agora isso aparece na tela como erro.

## (B) Push: o que estava errado

O servidor tentava enviar, mas **a resposta do serviço de push não ficava em lugar nenhum**:

- `push_envios` era gravado antes do envio. Depois, só o número de aparelhos que **aceitaram** era atualizado;
- a recusa (403, 400, 5xx) era engolida, **sem log**;
- só 404/410 apagavam a inscrição. Um 403 só contava falha.

Os pontos pedidos, um a um:

1. **O resultado de cada aparelho agora fica registrado.**
   - Em `push_envios`: `resultados` traz o aparelho, o serviço (Google, Apple…), ok, o statusCode e o motivo; `falhas`
     traz quantos recusaram.
   - Em `push_subscriptions`: `ultimo_status`, `ultimo_erro` e `ultimo_erro_em`.
   - Toda recusa vai para o log com o serviço e o status. O endpoint e as chaves nunca vão para o log.
   - 404/410 apagam a inscrição. **403/401 (chave VAPID diferente) também apagam**: ela nunca vai funcionar, e o app
     se reinscreve sozinho com a chave atual.
2. **Chave VAPID do servidor × chave da inscrição.**
   - A pública vai ao navegador pela mesma env do servidor (`VAPID_PUBLIC_KEY`, lida em `/api/push/chave` na hora).
     Não há `NEXT_PUBLIC_` nem cópia compilada.
   - **Achado:** ao ativar, o app **reaproveitava qualquer inscrição** que o navegador já tivesse, mesmo feita com
     **outra chave** (as chaves foram trocadas, ou o aparelho se inscreveu num ambiente de teste). O serviço de push
     recusa essa inscrição com 403, e o erro sumia. Agora:
     - o app compara a chave da inscrição com a do servidor;
     - se diferente, cancela e inscreve de novo;
     - a inscrição de outra chave aparece como "inativa";
     - o servidor também confere: grava só a **impressão** (sha-256, 12 caracteres) da chave usada e responde 409
       "reinscrever" para outra chave.
   - `VAPID_SUBJECT` já era validado (`mailto:` ou `https://`). Sem ele, o push fica desligado e o diagnóstico diz
     qual variável falta.
   - O diagnóstico confere se a **privada gera a pública** (par trocado ou colado pela metade = todo envio recusado).
     Ele responde só sim/não.
3. **O envio roda e termina dentro da função.**
   - O envio de um evento já rodava com `after()` do Next 15.5, que na Vercel é `waitUntil`: a função espera o envio
     terminar.
   - O "Enviar teste" sempre foi `await`.
   - Agora cada aparelho também espera a resposta do serviço antes de gravar o resultado (teste em
     `hotfix-push.test.ts`).
4. **O service worker mostra a notificação.**
   - O evento `push` faz `event.waitUntil(registration.showNotification(título, {body, …}))` em todo push, como o
     iPhone exige (PWA na tela de início, iOS 16.4+). Mensagem ilegível vira um aviso genérico, nunca nada.
   - Por precaução, o arquivo do push (`/worker-<hash>.js`, que o `sw.js` importa) saiu do middleware, como o
     `sw.js` já tinha saído.
5. **O escritório não tinha nenhuma inscrição.**
   - O painel (Dashboard) mostra o convite **"Receba os avisos neste computador"**, com Ativar e "Agora não"
     (some por 14 dias), para quem ainda não ativou. A escolha dos tipos continua em Meu perfil › Notificações.
   - O comentário do técnico avisa **quem está ligado à OS** no escritório: o responsável, quem abriu a OS, quem já
     conversou e quem já leu a conversa. Se nenhum deles tem aparelho, avisa o escritório todo que vê OS (como antes),
     para o aviso não se perder.
   - Ao abrir o app ou o painel, com a permissão já dada, a inscrição é conferida e regravada, sem pedir nada.

## A rota de diagnóstico (só ADMIN)

`POST /api/push/diagnostico` com o corpo `{ "usuarioId"?: "..." }` (padrão: quem pede). Ela:

- devolve `servidor`:
  - `ligado`;
  - `faltando` (o **nome** das variáveis que faltam);
  - `assuntoValido`;
  - `parDeChavesConfere`;
  - `impressaoDaChavePublica`;
- manda um "Teste de diagnóstico" para **cada aparelho** da pessoa (sem a trava de repetição nem a preferência);
- devolve, por aparelho:
  - o aparelho (ex.: "Android · Chrome") e o serviço;
  - `chaveConfere`;
  - `ok`, `status` e `motivo`;
  - o `detalhe` que o serviço respondeu;
  - se a inscrição foi `removido`a.

**Nenhuma chave sai na resposta** (há teste). Para rodar em produção, logado como ADMIN, no console do navegador:

```js
await (await fetch("/api/push/diagnostico", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()
```

**Como ler o resultado:**

| Resultado | O que é |
|---|---|
| `parDeChavesConfere: false` | as chaves do Vercel não são um par. Gere de novo (`scripts/gerar-chaves-vapid.mjs`), cole as três, faça o redeploy, e cada aparelho ativa de novo |
| status 403/401 "outra chave VAPID" | a inscrição foi feita com outra chave. Ela é apagada; abrir o app reinscreve |
| 404/410 | a inscrição expirou (apagada; ativar de novo) |
| `ok: true` e nada aparece no aparelho | o serviço de push **aceitou**: falta o aparelho mostrar. Confira a permissão do sistema; no iPhone, o app instalado na tela de início; o modo foco/não perturbe |

## O SQL (🔵)

`prisma/sql/2027-02-13_push_resultado_por_aparelho.sql`:

- `push_envios`: `falhas` (padrão 0) e `resultados` (jsonb);
- `push_subscriptions`: `chave_impressao`, `ultimo_status`, `ultimo_erro` e `ultimo_erro_em`.

Ele não apaga nem atualiza nada. Testado em PostgreSQL real (`sql-hotfix-push`): roda 2× e o `migrate diff` fica vazio.

## Testes

| Arquivo | O que trava |
|---|---|
| `hotfix-push-e2e-pg` (6, **web-push de verdade** contra um serviço de push HTTPS local, PostgreSQL real) | o envio assinado com a chave pública do servidor, cifrado (aes128gcm) e **decifrado** com as chaves do aparelho; o resultado por aparelho; 403 de outra chave e 410 apagam, 500 conta falha com motivo; a inscrição com outra chave dá 409; o diagnóstico (só ADMIN, sem chave na resposta, par trocado acusado, variável que falta pelo nome); o comentário do técnico avisa quem está ligado à OS (e, sem ninguém, o escritório); o escritório lê os comentários do app com a atividade e o "novo" |
| `hotfix-push` (11, regra) | a leitura da resposta, o motivo, o serviço pelo endpoint, a impressão (não revela a chave), o par conferido, o middleware sem os arquivos do service worker, o `showNotification` do service worker, o envio com `await`, nenhuma chave em log ou resposta, o SQL |
| `hotfix-push-ui` (11, tela) | os comentários se atualizam a cada 20 s (não com a aba escondida; ao voltar, sim), com a atividade e o "novo"; o erro aparece; o navegador refaz a inscrição de outra chave sem pedir permissão; o "ativo" só com a chave atual; a sincronização uma vez por aba; o convite do escritório |
| `sql-hotfix-push` (2, PostgreSQL real) | o SQL de produção |

**Testes antigos atualizados de propósito:**

- `push-pg` (1): o envio passa a dizer em quantos aparelhos houve recusa (`falhas`) e grava o resultado por aparelho;
- `push-ui` (2): a inscrição de teste guarda a chave com que foi feita, como o navegador real, e o corpo da inscrição
  leva a chave para o servidor conferir.
