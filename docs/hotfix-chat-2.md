# Hotfix 2 — o chat do técnico (o teste do Zé no iPhone)

**O relato:**
- O Zé entrou no app como técnico, com três OS no dia.
- As mensagens para a OS-4440 e a OS-4441 foram recusadas, sem dizer por quê. A da OS-4442 subiu.
- Também relatou:
  - o ponto (•) aparecia em mais de um chip;
  - os pushes se empilhavam;
  - mensagens das 06:42–06:45 seguiam sem ✓✓, mesmo já respondidas;
  - as fotos chegavam com 520–556 KB.
- No complemento, o print de Perfil › Sincronização:
  - o motivo das duas recusas era "Esta atividade não está atribuída a você. Fale com o escritório.";
  - a lista se chamava "Recusadas pelo escritório";
  - o item se chamava "Comentário";
  - o aviso dizia "As próximas gravações desta OS esperam esta".

## 1. Por que o servidor recusava uma OS que o seletor oferecia

**A causa (reproduzida em PostgreSQL real):**
- O filtro das "OS do dia" do seletor juntava duas condições com a chave `OR`, num mesmo objeto do Prisma:
  - `...atividadesDoTecnico(t)`, que já é um `{ OR: [...] }` (atribuída ao técnico, como 2º técnico ou pela equipe);
  - `OR: [em andamento, agendada para hoje]`.
- A segunda chave `OR` **sobrescrevia** a primeira. O filtro do técnico sumia.
- O resultado: os chips mostravam toda atividade em andamento ou de hoje **da empresa inteira**.
- Ao enviar, o servidor confere a atribuição e recusava, com razão, as atividades que não eram do técnico (403, "não está atribuída").
  - Pode ser a atividade de outro técnico, ou a sem técnico, numa OS do mesmo cliente no mesmo dia.
- O motivo ficava só na dica do balão, que o celular não mostra.

**A regra certa, agora uma só:**
- Se o técnico VÊ a OS no dia dele, conversa sobre ela. Se não vê, o chip não aparece.
- O seletor usa a **mesma consulta do "Meu dia"** (`ondeMeuDia`), menos as OS canceladas, que não recebem mensagem.
  - Essa consulta pega as atividades dele, como responsável ou na equipe.
  - Pega as de hoje, e as em andamento de qualquer data, que ainda não terminaram.
  - **Também corrigido no "Meu dia":** a atividade em andamento SEM data ficava fora dele, porque a regra era "data anterior a hoje". Agora ela aparece em "Começadas antes — falta concluir". O seletor do chat a oferecia; agora os dois concordam.
- A gravação confere a mesma atribuição (`atividadesDoTecnico`). Todo chip oferecido é aceito.
- Numa OS com uma atividade dele e outra de outro técnico, o chip sobe pela dele.

**O teste (PG real):** o técnico tem estas OS no dia:
- uma atribuída a ele;
- uma pela equipe, já iniciada;
- uma ainda não iniciada;
- uma do mesmo cliente com uma atividade dele e outra de outra técnica, em andamento;
- uma dele, em andamento e sem data.

Também há:
- uma OS do mesmo cliente, hoje, com a atividade **sem técnico**;
- uma OS só de outra técnica, em andamento.

O teste confere:
- os chips são exatamente as OS dele, as mesmas atividades do "Meu dia";
- a sem técnico e as da outra técnica não aparecem;
- cada chip é aceito pelo envio;
- a atividade da outra técnica volta 403, com o motivo.

## 2. A recusa diz o porquê, no balão

**O motivo fica à vista, em português**, sob "Não enviada":

| Recusa | O que o balão diz |
|---|---|
| 403 | Esta OS não está atribuída a este técnico. Envie sem OS ou troque a OS. |
| 404 | OS não encontrada. Envie sem OS ou troque a OS. |
| 409, OS cancelada | OS cancelada: não recebe mais mensagens. Envie sem OS ou troque a OS. |
| outra | o texto do servidor |

Quando a mensagem já era sem OS, o complemento "Envie sem OS ou troque a OS" não aparece.

**As ações dependem do tipo de falha:**
- **Falha de rede ou do servidor** (sem resposta, 5xx, 401, 408, 429): "Tentar de novo". A mensagem continua na fila e sobe sozinha quando der.
- **Recusa definitiva** (as outras 4xx):
  - **Enviar sem OS:** a mesma mensagem, com o mesmo identificador, sobe sem OS. Não duplica.
  - **Trocar a OS:** mostra as outras OS do dia, sem a que recusou, e reenvia na escolhida.
  - **Descartar:** tira do aparelho. Só existe para o que **nunca subiu**: uma mensagem enviada nunca se edita nem se apaga (regra do produto).

## 3. A mensagem recusada nunca segura o serviço da OS

**Antes:** uma operação recusada travava a fila da atividade inteira. Checklist, fotos, materiais e conclusão ficavam "adiados" atrás de uma mensagem do chat.

**Agora:** a mensagem do chat recusada **não trava**, como já valia para o QR (C13). O serviço da mesma OS segue.
- Vale no aparelho e no servidor.
- Vale também para a mensagem com dados inválidos, por exemplo vazia. Antes, essa ainda travava no servidor.
- A lista do que não trava fica num lugar só (`lib/tecnico/offline/trava.ts`).

## 3a. Perfil › Sincronização

| Antes | Agora |
|---|---|
| o selo do topo "1 recusada" | "1 não enviada" |
| "Recusadas pelo escritório (continuam guardadas)" | "Não enviadas", com "O sistema não aceitou estas gravações. Continuam guardadas no aparelho." Ninguém do escritório recusou: foi regra do sistema. |
| "Comentário" | "Mensagem do chat · OS-4440 · “Opa”" (ou "Foto"; sem OS, "Sem OS"), para saber qual é. |
| o motivo cru do servidor ("…atribuída a você…") | o mesmo motivo do balão, sem "você" |
| "As próximas gravações desta OS esperam esta" | "O serviço desta OS sobe normalmente. No Chat: Enviar sem OS, Trocar a OS ou Descartar.", com "Abrir o Chat" |

**O número da OS** fica guardado com a mensagem, só no aparelho; não sobe.
- Assim o balão e o Perfil dizem qual é a OS, mesmo quando ela sai das OS do dia.
- A mensagem é resolvida no balão do Chat, onde o motivo aparece ali mesmo.

## 4. O ponto (•): um só, com legenda

**O ponto significa "Atividade em andamento"**, e só uma OS o tem: a atividade em andamento iniciada por último.

- Abaixo dos chips, a legenda "• Atividade em andamento" aparece quando algum chip tem o ponto.
- Para leitor de tela, o nome do chip diz "(atividade em andamento)".
- A OS escolhida ao abrir é a que tem o ponto.

## 5. O push

**O formato:**

| Mensagem | Título | Corpo |
|---|---|---|
| com OS | Mensagem nova · OS-4442 · Mercado Fictício | João: Opa |
| foto, sem texto | Mensagem nova · OS-4442 · Mercado Fictício | João: Foto |
| sem OS | Mensagem nova · João | João: Opa |

O nome do cliente é cortado em 24 caracteres.

**Um push por conversa, não por mensagem.**
- A etiqueta (`tag`) é a da conversa. O aviso novo substitui o anterior da mesma conversa e toca de novo (`renotify`).
- Antes, a etiqueta era por OS ou por nome, e uma conversa empilhava vários avisos.

## 6. O ✓✓ das mensagens antigas

**Daqui para a frente:**
- O hotfix 1 já marcava como lido ao responder ("responder é ler").
- O teste em PG confirma: a resposta do escritório marca como lidas as mensagens do técnico até ali.

**As antigas (como as das 06:42–06:45):**
- **Regra:** a mensagem sem ✓✓ que o outro lado respondeu depois conta como lida por quem respondeu, na hora da resposta.
- **Quando se aplica:** a cada abertura da conversa, no escritório e no app.
- Não há SQL de correção em massa: as conversas se acertam ao serem abertas.

## 7. As fotos menores

**Antes:** a foto ia com o lado maior em 1600 px e JPEG 0,8. Chegava a 370–860 KB. As do Zé tinham 520–556 KB.

**Agora:**
- A redução é em degraus, até caber no alvo:
  - **foto:** alvo ≤ 200 KB; tenta 1280 px / 0,7, depois 1024 px / 0,6, depois 800 px / 0,55;
  - **miniatura:** alvo ≤ 15 KB; tenta 256 px / 0,6, depois 192 px / 0,5.
- O formato continua JPEG: o Safari do iPhone não gera WebP pelo canvas.
- O limite do servidor não mudou, para não recusar fotos antigas que ainda estão na fila de algum aparelho.

**Medido no Chromium,** com cenas sintéticas de 12 MP (4032×3024, JPEG 0,92, como sai do celular):

| Cena | Original | Antes (1600/0,8) | Agora | Degrau | Miniatura agora (antes) |
|---|---|---|---|---|---|
| parede lisa | 1.918 KB | 62 KB | 19 KB | 1280/0,7 | 1,4 KB (2 KB) |
| etiqueta do equipamento | 3.669 KB | 370 KB | 118 KB | 1024/0,6 | 12 KB (21 KB) |
| aletas da condensadora | 4.510 KB | 369 KB | 189 KB | 1280/0,7 | 8 KB (17 KB) |
| ruído forte (pior caso) | 8.581 KB | 857 KB | 144 KB | 800/0,55 | 11 KB (29 KB) |

No banco, a foto vai como texto (base64), cerca de 1,33 vez o tamanho acima.

A proposta de armazenamento externo segue no CHAT-1.1 (`docs/armazenamento-fotos.md`). A contratação é decisão do Zé.

## Como foi testado

**Regras puras e telas** (`tests/unit/hotfix-chat-2.test.ts`):
- o motivo, sem "você";
- o rótulo "Mensagem do chat · OS · começo" e o número da OS guardado com a mensagem;
- a marca de recusa na fila;
- o que não trava;
- "responder é ler, para trás", dos dois lados;
- a legenda e o nome acessível do ponto;
- as ações do balão.

**PostgreSQL real** (`tests/unit/hotfix-chat-2-pg.test.ts`):
- o seletor e o envio com a mesma fonte, a mesma do "Meu dia";
- a OS do mesmo cliente com atividade sem técnico, ou de outro técnico, fora do seletor;
- a mensagem inválida que não segura o início da atividade;
- o ponto único;
- a recusa da OS de outro técnico, sem travar a fila;
- o push (título, corpo, etiqueta);
- o ✓✓ das antigas ao abrir.

**O app inteiro** (`tests/unit/chat-1-app-ui.test.ts`):
- "Enviar sem OS" reenvia com o mesmo identificador;
- "Trocar a OS" oferece só as outras;
- "Descartar" tira da fila;
- o caso do print: o motivo no balão; checklist e conclusão da mesma OS sobem; Perfil com "Não enviadas", "Mensagem do chat · OS-1 · …", sem "esperam esta" e com "Abrir o Chat".

**Mutação:** 21/21 mutantes mortos. Cada mutante desfaz uma correção, e algum teste falha.

**Prints** (`docs/prints/hotfix-chat-2/`): iPhone 390×844 com as áreas do relógio e do gesto simuladas, dados fictícios.
