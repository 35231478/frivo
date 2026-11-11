# App do técnico — Meu dia: a OS abre pelo "Cheguei"

🟢 **Sem mudança de banco.** Comportamento de tela, mais três campos que o servidor passou a mandar
no card (lidos de colunas que já existiam).

O "A caminho" e o "Cheguei" são os mesmos de `docs/tecnico-aviso-cliente.md`: um toque de cada por
dia, horário registrado na atividade e no histórico da OS, e-mail ao cliente se houver sinal na hora.
**O que mudou é onde o técnico toca e o que o "Cheguei" faz.**

## O que mudou

1. **Botões do card.** Saiu o "Ligar". Antes de chegar: "Rota no mapa" e **"Cheguei"** (principal,
   cheio, na cor da marca). "A caminho" virou uma ação discreta embaixo ("Avisar que estou a
   caminho"): é opcional, e o "Cheguei" não depende dela.
2. **"Cheguei" entra na OS.** Registra a chegada, avisa o cliente e abre a execução — com ou sem
   sinal.
3. **A OS fica fechada até o "Cheguei".** Antes de chegar, tocar no card (corpo ou seta) não abre a
   execução. A trava vale por qualquer caminho: link direto, atalho da câmera, "voltar" do navegador.
4. **O card expande.** Antes de chegar, tocar no card abre para baixo o que o técnico precisa ler: o
   que o cliente pediu no chamado e a orientação do escritório. Toca de novo, recolhe.
5. **Câmera só no local.** O atalho "Câmera" aparece depois do "Cheguei" (ou com a OS em andamento).
6. **Dentro da OS não há mais botão** de "A caminho" / "Cheguei": só o registro do que foi tocado
   hoje, e o toque do WhatsApp.

## Os estados do card

| Estado | Quando | O card mostra | Tocar no card | Ações |
|---|---|---|---|---|
| **Antes de chegar** | Agendada, sem toque hoje | "Agendada", seta para baixo | Expande / recolhe | Rota · **Cheguei** · "Avisar que estou a caminho" |
| **A caminho** | Tocou "A caminho" hoje | "A caminho" + registro "avisado às 13:40" | Expande / recolhe | Rota · **Cheguei** |
| **Chegou** | Tocou "Cheguei" hoje | "No local" + registro "avisado às 14:02" | Abre a OS | Câmera · Rota |
| **Em andamento** | Já tem gravação (de hoje ou de outro dia) | "Em andamento" | Abre a OS | Câmera · Rota |
| **Concluída** | — | "Concluída", esmaecida | Abre para leitura | Rota |

- "Chegou" e "Em andamento" são coisas diferentes: o "Cheguei" **não** começa o atendimento. A
  atividade segue "Agendada" no escritório até a primeira gravação da execução, como antes.
- **OS em andamento entra direto**, sem pedir "Cheguei" de novo — inclusive a que continua de outro
  dia.
- O "Cheguei" vale por dia: numa OS que segue agendada, o de ontem não abre a porta hoje.

## Comportamento offline do "Cheguei"

- **Entrar na OS é local.** O toque grava a chegada no aparelho e a OS abre na hora, sem esperar
  resposta do servidor. Sem sinal, funciona igual.
- **O aviso segue a regra de sempre:** com sinal, sai na hora; sem sinal, o horário fica na fila e o
  aviso só sai se o sinal voltar em até 5 minutos. Passou disso, o horário sobe e o cliente **não**
  recebe aviso velho — o registro diz "sem aviso (sem sinal)".
- **Fechar e reabrir sem sinal não perde a chegada:** o card continua "No local" e a OS abre.
- **O card não desaprende.** Ele junta três fontes: a lista baixada, a OS guardada no aparelho (a
  mesma que a tela da OS usa) e a fila. Se a chegada já subiu e o sinal caiu de novo, o card sabe pela
  OS guardada.
- **Se o aparelho não conseguir guardar** (sem espaço): avisa, **não** entra na OS e o botão volta a
  valer. Não finge que gravou.
- A OS precisa estar no aparelho para abrir sem sinal (o Meu dia baixa as do dia ao abrir com
  internet) — regra que já existia.

## O card expandido

| A OS | Título | De onde vem |
|---|---|---|
| Veio de um chamado do cliente (portal ou QR Code) | "O que o cliente pediu" | Descrição da OS |
| Aberta pelo escritório | "Descrição do serviço" | Descrição da OS |
| Qualquer uma, se houver | "Orientação do escritório" | Observação da atividade + Observações da OS |

**Decisão para conferir:** o sistema não tem um campo chamado "orientação". Usei os dois lugares
onde o escritório escreve para a visita: a **Observação** da atividade e as **Observações** da OS
(as mesmas que já saem no relatório do cliente). Se a orientação deveria vir de outro lugar, ou ser
um campo próprio, é ajuste pequeno.

A mesma descrição e orientação aparecem no cabeçalho da OS, depois de entrar.

### Permissão "Exibir dados do cliente"

Antes, com essa chave desligada, a descrição **inteira** era escondida. Agora:

- **o texto do serviço fica** (o técnico precisa saber o que fazer), e a orientação também;
- **sai a identidade de quem pediu.** O chamado do QR Code grava no fim da descrição
  "Solicitante: nome · E-mail · Telefone": esse rodapé não sai do servidor. Só com "Exibir contatos"
  desligado, fica o nome e saem e-mail e telefone;
- nome do cliente, unidade, endereço e rota continuam escondidos, como antes.

**Limite:** o que o cliente (ou o escritório) digitou no meio do texto não dá para separar. Se alguém
escrever "falar com a Marta" na descrição, isso aparece.

## Outras decisões — confira

1. **"Avisar o cliente" desligado na empresa.** A trava vale do mesmo jeito: o "Cheguei" continua
   sendo a porta da OS e registra o horário, **sem enviar nada** (o servidor já tratava esse caso).
   "A caminho" some, porque só serve para avisar.
2. **Agenda.** O card é o mesmo, então dá para tocar "Cheguei" numa OS de outro dia (adiantar um
   serviço). Como o toque avisa o cliente, **OS de outro dia pede confirmação** ("OS agendada para
   13/11 — Registrar a chegada agora?"). A de hoje não pergunta.
3. **OS que continua de outro dia** (em andamento) entra direto, como pedido. Consequência: no
   segundo dia não há toque de "Cheguei", então o cliente não é avisado da chegada nesse dia.
4. **WhatsApp** (o toque que abre a conversa com a mensagem pronta): continua. No card, ao lado do
   registro, depois de "A caminho"; dentro da OS, depois de "Cheguei". Só com "Exibir contatos do
   cliente" ligado.
5. **Sem confirmação no "Cheguei" de hoje**, como pedido (tocável direto). Um toque no card errado
   avisa o cliente errado; não há desfazer.
6. **"Ligar" saiu só do card.** O cabeçalho da OS, lá dentro, não foi mexido.

## O que reaproveitou × o que criou

| Peça | Situação |
|---|---|
| Gravação do toque, horário, e-mail, janela de 5 min, um por dia (`avisoCliente`) | **Reaproveitado**, sem mudança |
| Fila offline e sincronização | **Reaproveitado** |
| WhatsApp com a mensagem pronta | **Reaproveitado** |
| Botão de rota, atalho da câmera rápida | **Reaproveitado** |
| Estados do card e a regra da porta (`lib/tecnico/chegada.ts`) | **Criado** |
| Card expansível, "Cheguei" principal, "A caminho" discreto (`components/tecnico/meu-dia.tsx`) | **Criado** |
| Trava na entrada da OS (`components/tecnico/execucao.tsx`) | **Criado** |
| No card, do servidor: toques de hoje, "veio de chamado", orientação (`lib/tecnico/dia.ts`) | **Criado** (uma consulta a mais por lista) |
| Descrição sem a identidade de quem pediu (`lib/tecnico/cartao.ts`) | **Criado** |

## Testes

- `aviso-cliente-ui` (43, reescrito): o fluxo pelo card, no app com as vistas trocando pela URL —
  antes de chegar, expandir, "A caminho", "Cheguei" (com e sem sinal), a trava por link direto, em
  andamento, concluída, outro dia, WhatsApp, permissões e as regras puras. Todos os cenários do aviso
  que existiam (janela de 5 min, um por dia, cliente sem e-mail) seguem cobertos, agora pelo card.
- `aviso-cliente-pg` (+4, PostgreSQL real): a lista leva os toques de hoje, o chamado e a orientação;
  com os dados do cliente desligados o solicitante não sai do servidor; "Cheguei" com o aviso
  desligado registra sem enviar.
- Mutação: 26 regras quebradas de propósito (a porta da OS, os estados, o "Cheguei" que entra, a
  câmera, a privacidade, o servidor), todas pegas pelos testes.
- `app-tecnico-ui` e `app-tecnico-pg`: expectativas atualizadas **de propósito**:
  - os testes da execução passam a começar com o técnico já no local (sem isso a OS não abre);
  - o card não tem mais "Ligar"; antes de chegar não tem "Câmera" e não abre a OS ao toque;
  - com os dados do cliente desligados, a descrição do serviço fica.

## Conferido no navegador (Chromium, app real, desktop e celular)

| Cenário | Resultado |
|---|---|
| Meu dia | Antes de chegar: Rota · Cheguei · "Avisar que estou a caminho". Em andamento: Câmera · Rota. Nenhum "Ligar" |
| Tocar no card antes de chegar | Fica no Meu dia; expande com o pedido do cliente e a orientação |
| "A caminho" | Registro gravado no banco e no histórico da OS; a ação some; fica Rota · Cheguei |
| "Cheguei" | Entra na OS; chegada no banco e no histórico; atividade segue "Agendada"; nenhum botão de aviso dentro da OS |
| De volta ao Meu dia | "No local"; Câmera · Rota; o card abre a OS sem avisar de novo |
| OS em andamento | Entra direto |
| Link direto e atalho da câmera antes de chegar | Execução não abre; o "Cheguei" ali mesmo abre |
| Sem sinal, "Cheguei" | OS abre na hora; nada no banco; "aviso a enviar"; sinal de volta, a chegada sobe |
| Dados do cliente desligados | Pedido e orientação aparecem; nome, e-mail e telefone de quem pediu, não |
| "Avisar o cliente" desligado | Só Rota · Cheguei; "Cheguei · registrado às 14:21" |
| Agenda, OS de outro dia | Pede confirmação; cancelar não grava |

No ambiente dos prints não há chave de envio de e-mail: o toque é gravado, mas o e-mail não sai
("e-mail não enviado"). Para os prints do caso normal ("avisado às…"), o registro foi marcado como
enviado direto no banco de teste. O envio de verdade é coberto pelos testes com PostgreSQL.

Não testado: iPhone (sem WebKit neste ambiente) e fechar/reabrir o app sem sinal no navegador (o modo
de desenvolvimento não tem o service worker) — este último está coberto pelos testes de tela.
