# App do técnico — "Meu dia" lapidado (Etapa 2a)

> **Atualização** (`docs/tecnico-meu-dia-cheguei.md`): o card não tem mais "Ligar"; antes de o
> técnico chegar, tocar no card expande em vez de abrir a OS, e a OS abre pelo "Cheguei". Com os
> dados do cliente desligados, a descrição do serviço passou a ficar (sai só a identidade de quem
> pediu).

**Sem mudança de banco.** A tela já existia e funcionava; esta etapa fecha as pontas do dia a dia
(privacidade de ponta a ponta, rota no app que o técnico usa, progresso do dia, estados).

## Levantamento — o que já existia (mantido)

| Item pedido | Situação antes |
|---|---|
| Ao logar, cai no Meu dia (`/tecnico`) | Já existia (modo técnico no middleware) |
| Só as OS DELE de hoje, em ordem de horário (sem horário no fim) + as começadas antes | Já existia (`lib/tecnico/dia.ts`, escopo no servidor) |
| Cartão: cliente, endereço, botão de rota, horário, nº de equipamentos, selo de status e prioridade | Já existia |
| Tocar no cartão abre a execução da OS | Já existia |
| Barra inferior Meu dia · Agenda · Perfil, sem o menu do painel | Já existia |
| Carregando (esqueleto), vazio, lista guardada no aparelho sem sinal | Já existia |
| Ler os toggles de Equipes › App do colaborador na tela | Já existia desde o PR2 (só na tela) |

## O que foi criado / melhorado

1. **Privacidade no servidor.** Com "Exibir dados do cliente" desligado, nome, unidade, endereço,
   rota e descrição **nem saem do servidor** (Meu dia, Agenda e a OS); com "Exibir contatos"
   desligado, o telefone também não. Antes só a tela escondia — o dado ia para o aparelho.
   A tela continua conferindo (vale para o que já estava guardado).
2. **Cartão sem os dados fica limpo.** Mostra o título da OS e o número, sem repetir texto, e a
   unidade do cliente também some (o nome dela costuma entregar o cliente).
3. **Rota: Google Maps ou Waze.** Na primeira vez pergunta o app, lembra neste aparelho e passa a
   abrir direto; o Perfil troca ("App de rota"). Continua um link de verdade (Google Maps por
   padrão). A mesma rota vale no cabeçalho da OS.
4. **Progresso do dia e a próxima.** "4 OS para hoje · 1 concluída" com barra de progresso, a
   primeira OS ainda por concluir em destaque ("Próxima"), concluídas esmaecidas com o visto.
   Conta o que ele concluiu no aparelho e ainda não subiu.
5. **Estados.** Vazio com o texto "Nenhuma OS para hoje"; sem sinal e sem nada guardado ganhou
   "Tentar de novo"; lista vinda do aparelho diz "Guardado no aparelho · Atualizado às HH:MM";
   a lista se atualiza sozinha quando o sinal volta ou o técnico volta para o app.
6. **Toque ≥44px** no cartão e nos atalhos dos estados.

## Decisões

- **Ordem de rota = ordem do horário agendado** (como já era). Otimizar o trajeto por distância
  pede localização do aparelho e fica para outra etapa.
- Marca d'água com endereço: com "Exibir dados do cliente" desligado o endereço não chega ao
  aparelho, então não entra no carimbo.

## Testes

- `app-tecnico-ui`: permissões no cartão (dados, contatos, as duas), cartão já vindo sem dados,
  carregando, vazio, sem internet sem cache, progresso/próxima com conclusão no aparelho, selo de
  prioridade e toque, rota (escolha, lembrança, Perfil), regras puras (Waze, privacidade).
- `app-tecnico-pg` (Postgres real): o dado oculto não sai do servidor em Meu dia, Agenda e OS.

## Prints

`docs/prints/tecnico-meu-dia/` — celular (dia, escolha da rota, Perfil, agenda, sem internet,
permissões desligadas, vazio) e desktop.
