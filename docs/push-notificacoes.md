# Notificações push (com o app fechado)

Avisos no celular ou no computador mesmo com o Frivo fechado. O técnico recebe o que é dele e o escritório recebe o que acompanha; cada pessoa escolhe os tipos que quer.

**Sem as chaves no Vercel, fica tudo desligado, sem erro:**
- o botão de ativar não aparece;
- a aba "Notificações" do Meu perfil não aparece;
- nada é enviado.

## Passo a passo para ligar (uma vez)

1. **Gerar as chaves** no computador, na pasta do projeto:
   ```bash
   node scripts/gerar-chaves-vapid.mjs contato@suaempresa.com.br
   ```
   O script imprime três linhas: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`.
2. **Colar no Vercel:** projeto › Settings › Environment Variables › ambiente **Production**. Crie uma variável para cada linha, com o nome e o valor.
   - A chave **privada** é segredo: só no Vercel, nunca em código, chat ou e-mail.
3. **Fazer um novo deploy:** Deployments › último deploy › ⋯ › Redeploy. O servidor lê as chaves na hora, sem precisar recompilar, mas a variável nova só vale a partir de um deploy.
4. **Rodar o SQL** `prisma/sql/2027-02-04_push_notificacoes.sql`, **antes** de subir esta versão.
5. **Testar:** Meu perfil › Notificações › "Ativar notificações neste aparelho" › "Enviar teste".

**Não troque as chaves depois.** Trocar desinscreve todos os aparelhos, e cada pessoa precisaria ativar de novo.

### Opcional: conferir as atividades esquecidas com todos fora do sistema

O sino do escritório já confere a cada 5 minutos enquanto alguém usa o sistema. Para conferir também com todos fora, um agendador externo pode chamar a rota de hora em hora:

```
GET https://SEU-DOMINIO/api/cron/push
Authorization: Bearer <CRON_SECRET>
```

- O `CRON_SECRET` é o mesmo das outras rotinas.
- Pode chamar quantas vezes quiser: o mesmo aviso nunca sai duas vezes.
- A rota não está no `vercel.json` de propósito: no plano gratuito, o Vercel só aceita rotina diária, e um cron de hora em hora faria o deploy ser recusado.

## Como cada pessoa ativa

- **Técnico:** app › Perfil › Notificações › "Ativar notificações neste aparelho".
- **Escritório:** Meu perfil › aba Notificações. Ali também ficam a escolha dos avisos e a lista de aparelhos, com Revogar.
- **iPhone (iOS 16.4 ou mais novo):** só recebe com o Frivo **instalado na tela de início**. No Safari, toque em Compartilhar › Adicionar à Tela de Início e abra o Frivo por lá. A tela mostra essa orientação uma vez.
- **Permissão negada:** a tela avisa que as notificações estão bloqueadas. Para liberar, use as configurações do navegador ou do celular.

## O que chega e para quem

| Aviso | Quem recebe | Ao tocar |
| --- | --- | --- |
| Nova OS para você (cliente, data e hora) | os técnicos que **entraram** na atividade | abre a OS no app |
| OS reagendada | os técnicos da atividade | abre a OS no app |
| OS cancelada | os técnicos das atividades em aberto | abre a OS no app |
| Atividade esquecida em andamento | o técnico da atividade e o escritório (quem vê OS) | abre a OS |
| Ressalva, comentário ou nota baixa no aceite | o técnico da OS (menos quem colheu) e o escritório | abre a OS |
| Chamado novo do portal | o escritório (quem vê OS) | abre o chamado |
| Orçamento aprovado ou recusado | quem vê orçamentos | abre o orçamento |
| Saldo negativo por uso em campo | quem vê o estoque | abre o estoque |
| Comentário novo na OS (do app ou do escritório) | os técnicos da OS e o escritório, menos o autor | abre a OS |
| Despesa de campo | lançada no app: o escritório que aprova (Financeiro › Fluxo de caixa); aprovada ou recusada: quem lançou | escritório: Despesas de campo; técnico: Minhas despesas |

**Regras de quem recebe:**
- O **técnico** (modo técnico) só recebe o que é dele, nunca a empresa inteira.
- O **escritório** recebe pelo mesmo critério do sino: a permissão de cada aviso.
- A geração **automática** das OS recorrentes do contrato não avisa. É a agenda do mês inteiro de uma vez; o técnico vê as OS no app.

**Não repete:** cada aviso é registrado em `push_envios` antes de sair, com uma chave por pessoa e evento.

**Limpeza:** aparelho que o navegador recusa de vez (desinstalou, revogou, expirou) é apagado no envio. Depois de 5 falhas seguidas, também.

## Onde está no código

| O quê | Onde |
| --- | --- |
| Regras puras (tipos, quem pode receber, preferências, textos, aparelho) | `lib/push/tipos.ts` |
| Chaves do ambiente | `lib/push/config.ts` |
| Envio | `lib/push/servidor.ts`, função `enviarPush` |
| Eventos | `lib/push/eventos.ts` |
| Service worker | `worker/index.ts`, com a parte pura em `lib/push/sw.ts` |
| Rotas | `/api/push/*` e `/api/cron/push` |
| Tela | `components/push/notificacoes-aparelho.tsx` |

## Comentários e despesas do app de campo

Os dois PRs do app entraram no master durante esta leva (#258, comentários; #259, despesas). As chamadas já estão ligadas:
- **Comentário na OS:** em `lib/execucao/comentarios.ts`, nos caminhos do app e do escritório. Só comentário novo avisa; o reenvio da mesma gravação não.
- **Despesa de campo:** em `lib/execucao/despesas.ts`, ao lançar, aprovar e recusar.
  - O aviso relê a situação da despesa antes de sair: aprovação desfeita, ou decisão que outra pessoa tomou antes, não avisa.
  - O lançamento reenviado pelo app não avisa de novo.
