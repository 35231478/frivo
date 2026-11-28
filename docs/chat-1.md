# CHAT-1 — Chat interno estilo WhatsApp (Fase 1)

**Objetivo de negócio:** tirar a conversa de trabalho do WhatsApp, que custa uns R$ 600/mês em chips para os técnicos, e deixar cada conversa registrada na OS. Roda em paralelo com o WhatsApp; nada foi removido.

**O desenho (aprovado pelo Zé): a conversa é POR PESSOA, e o registro continua na OS.** A gente pensa "preciso falar com o João", não "OS 1.234"; com centenas de mensagens por dia, uma lista por OS fica ilegível. Por isso:
- a lista do escritório é de colaboradores;
- cada mensagem leva a OS dela, ou nenhuma;
- dentro da OS aparecem só as mensagens daquela OS, de todos os envolvidos.

É a mesma mensagem filtrada de dois jeitos: fonte única, nada duplicado.

**Não é outro sistema.** As mensagens são as de `os_comentarios`, os comentários da OS, com origem APP ou ESCRITÓRIO. Essa base já tinha `client_id` (envio offline sem duplicar), `os_comentarios_lidos` (não lidas) e push. O chat evolui essa base.

## O que mudou, por tela

| Onde | O quê |
|---|---|
| Escritório › **Conversas** (menu Operações e ícone com contador no topo) | Estilo WhatsApp Web, com a chave **"Pessoas \| OS"** no topo (padrão: Pessoas). **Pessoas:** à esquerda os técnicos com login no app (foto ou iniciais, nome, a última mensagem com a OS dela, hora, não lidas); não lidas primeiro, depois a mais recente; busca por nome, nº de OS e cliente. À direita, a conversa com a pessoa: cada grupo de mensagens da mesma OS fica sob uma etiqueta discreta da OS (nº + cliente, clicável → abre a OS); acima do campo de texto, o seletor de OS. **OS:** uma conversa por OS (nº, cliente, técnicos), a lista da primeira versão. No celular, uma coisa de cada vez, com "voltar". A conversa aberta fica no endereço (`/conversas?pessoa=` ou `?os=`), e é para lá que o push e o sino levam. |
| **Seletor de OS** (acima do campo de texto, na conversa com a pessoa e no app) | A OS da mensagem vem **sozinha**: a da atividade em andamento do técnico; senão a última OS usada na conversa hoje; senão "Sem OS". Em 1 toque troca entre as OS da pessoa no dia e "Sem OS". No escritório há ainda **"Outra OS"**, uma busca pelo nº ou pelo cliente. |
| Escritório › **OS › Resumo** | O card "Comentários" virou "Conversa": só as mensagens daquela OS, de todos os envolvidos, com "para Fulano" quando o escritório escreveu para uma pessoa só. Tem o link para a tela de conversas. A atualização a cada 20 s saiu; o tempo real entrou no lugar. |
| **App do técnico › Chat** (barra inferior, com contador) | **Uma conversa principal: "Escritório".** O técnico não escolhe pessoa: qualquer um do escritório com permissão vê e responde, e o balão mostra quem respondeu. Cada mensagem tem a etiqueta da OS automática e o mesmo seletor de 1 toque. Dentro da OS (a execução), ele vê só as daquela OS, e há "Abrir no Chat". |
| **Push** | "Mensagem nova na OS …" ou, sem OS, "Mensagem nova de Fulano", com o botão "Abrir conversa". **Técnico:** abre o Chat. **Escritório:** abre a conversa com a pessoa que escreveu, ou a da OS, quando quem escreveu foi alguém do escritório. **Quem recebe:**<ul><li>mensagem da OS: os técnicos dela e o escritório ligado a ela;</li><li>mensagem do escritório para uma pessoa: só ela;</li><li>mensagem do técnico sem OS: quem do escritório conversa com ele.</li></ul> |
| **Sino** (reserva do push) | "Mensagens novas do campo": uma só abre a conversa; várias abrem a lista. |

## Quem recebe cada mensagem

- **O técnico escreve,** com ou sem OS: a mensagem fica na conversa dele com o escritório. Se tem OS, aparece também na OS.
- **O escritório escreve PELA OS** (o Resumo da OS, ou a visão OS da tela Conversas): a mensagem vai para **todos os técnicos da OS** e aparece na conversa de cada um. Foi sempre assim; as mensagens de antes desta leva seguem a mesma regra, sem nenhuma carga de dados.
- **O escritório escreve PELA CONVERSA de uma pessoa,** com ou sem OS: vai **só para ela**. Se tem OS, aparece na OS com o destinatário indicado.
- **Mensagem sem OS** ("passa no escritório antes de ir embora"): fica só na conversa da pessoa.
- **Técnico ↔ técnico:** fora desta leva.

## Decisões (para o Zé conferir)

1. **Modelo de dados: evoluir `os_comentarios`**, sem uma tabela nova de mensagens que os comentários alimentem. Escolhi pelo menor risco: uma fonte só, nada a sincronizar e nada duplicado.
   - **A OS da mensagem passa a ser opcional.** A coluna só deixa de exigir valor; nenhuma linha muda.
   - **`para_usuario_id`:** o destinatário, quando é uma pessoa só.
   - **`conversas_leituras`:** até quando cada pessoa leu a conversa de cada técnico, para o contador por pessoa. A leitura por OS continua em `os_comentarios_lidos`. Ler a conversa da pessoa também avança a leitura das OS que aparecem nela, para o sino e a visão OS ficarem coerentes.
2. **Permissão nova "Conversas"** (ver e enviar), na seção Operação dos perfis.
   - **O administrador tem sempre. Os perfis que já existem NÃO recebem nada pelo banco.** Para ligar: Configurações › Perfis de acesso › Conversas.
   - **Sem "Conversas":** a pessoa usa só a visão por OS (com "OS › Visualizar"; escrever pede "OS › Editar").
   - **Com "Conversas":** vê a visão por pessoa. As mensagens com OS ainda seguem a permissão de OS e o "Ver só os próprios" da COM-1, e a mensagem sem OS pede só "Conversas".
3. **A foto mora numa tabela própria do chat** (`os_comentarios_fotos`), no mesmo formato e com a mesma validação dos anexos da OS: data URL no banco, conferida pelo conteúdo do arquivo.
   - **Por que não em `os_anexos`:** essa tabela alimenta a galeria, o relatório do cliente e o portal, e uma foto do chat interno ali correria o risco de aparecer para o cliente.
   - **O vínculo da foto com o equipamento** (galeria do equipamento e relatório da atividade, por referência) é a **CHAT-1.1**, o PR seguinte.
4. **Limite da foto: 1,5 MB depois de reduzida.**
   - O aparelho reduz a foto com o mesmo redutor do resto do sistema (orientação certa, lado maior de até 1600 px, JPEG 80%). Uma foto de 3–8 MB costuma ficar entre 200 e 500 KB.
   - Se ainda passar, reduz de novo (1280 px). Se continuar passando, avisa: "A foto passa de 1,5 MB mesmo reduzida. Tire outra ou escolha uma menor."
   - A miniatura do balão (320 px) também é feita no aparelho; a foto inteira só desce ao ampliar.
5. **"Lida" exata por mensagem.** A 1ª leitura por alguém que não o autor fica na própria mensagem (`lida_em`, `lida_por_id`), e a dica do ✓✓ diz "Lida por Fulano às 14:05". **Símbolos:** relógio = enviando; ✓ = no servidor; ✓✓ = lida; "Não enviada" vem com "Tentar de novo".
6. **OS cancelada:** a mensagem com essa OS fica recusada (409, e a tela tira a caixa de escrever na visão OS). **OS concluída:** segue aberta, como histórico que pode continuar.
7. **Contador do topo:** quantas conversas têm mensagem por ler. Para quem tem "Conversas", conta por pessoa; senão, por OS. **Não lida por pessoa:** o que o técnico mandou depois da sua última leitura da conversa dele.
8. **"Exibir dados do cliente" desligado no app:** o nome do cliente nem sai do servidor para o técnico, nem na etiqueta da OS, nem no seletor.
9. **Nada de editar ou apagar mensagem.**

## Tempo real: a escolha e o custo

**A escolha: long-polling curto**, sem websocket próprio, que a Vercel não mantém.

**Como funciona:**
- O aparelho pergunta "mudou algo desde a marca X?". A marca reúne três coisas:
  - a mensagem mais nova;
  - a 1ª leitura mais nova, porque o ✓✓ também é novidade;
  - a leitura mais nova de quem pergunta, porque ler uma conversa que outro já leu muda o seu contador.
- O servidor segura a resposta por até **8 s**, olhando o banco a cada **2 s** com uma consulta de índice, e responde na hora em que algo muda.
- Na prática, a mensagem aparece em até cerca de 2 s.
- **Um laço por aba:** o ícone do topo, a lista e a conversa aberta dividem a mesma conexão.
- **Aba escondida, ou app em segundo plano, para.** Ao voltar, pergunta na hora. Fora da tela, quem avisa é o push.
- **Erro de rede:** espera 2 s, 4 s, 8 s… até 30 s.
- **Proteções:**
  - resposta sem marca válida (proxy, página de erro) conta como erro;
  - resposta rápida sem mudança espera 1 s antes da próxima, então nunca entra em laço apertado;
  - o contador do topo só é recalculado quando algo muda.

**Por que não SSE:** na Vercel, SSE também é uma função aberta o tempo todo, com o mesmo custo. É mais frágil atrás de proxy e de rede móvel, que cortam conexões longas, e mais difícil de retomar.

**O custo, numa conta grosseira para a Clima Total:**
- **Uso considerado:** 10 pessoas no escritório com o sistema aberto e 15 técnicos com o app na frente, 9 h por dia, 22 dias por mês.
- **Requisições:** cerca de uma a cada 8 s por tela aberta, o que dá ≈ 100 mil por dia, ≈ 2,2 milhões por mês.
- **Vercel Pro:** 1 milhão de invocações por mês está incluído; o excedente custa cerca de US$ 0,60 por milhão, ou seja, **≈ US$ 1/mês**. Enquanto o pedido espera, a CPU fica parada, e várias esperas dividem a mesma instância.
- **Banco:** cerca de 4 consultas de índice por pedido; no horário comercial o banco já fica acordado.
- **Comparação:** ordem de grandeza menor que os R$ 600/mês de chips.

## Offline no app

- **Envio:** pela **fila** que o app já usa, com a operação "comentario", que agora leva também a foto e a miniatura.
  - com OS, pela atividade do técnico naquela OS;
  - sem OS, por "sem-os", o mesmo caminho da despesa sem OS.
- **Sem sinal:** a mensagem aparece na hora como "Enviando…" e sobe sozinha quando o sinal volta. O `clientId` faz o reenvio não duplicar, também no escritório.
- **Recusada:** aparece "Não enviada", com o motivo e "Tentar de novo".
- **Lida sem sinal:** a conversa guardada no aparelho, com o aviso de que é da última sincronização.

## Isolamento

- **Escritório:** o que está descrito no item 2 das decisões. Fora do escopo, a mensagem não aparece; a foto e a conversa respondem 404.
- **Técnico:** só a conversa dele, e as OS em que tem atividade. A mensagem do escritório para outra pessoa, ou numa OS de outro técnico, não chega a ele.
- **Multiempresa:** tudo filtrado pela empresa da sessão.

## SQL 🔵

`prisma/sql/2027-02-20_chat_1.sql`, aditivo e idempotente:
- **`os_comentarios`:**
  - `lida_em`, `lida_por_id`, `para_usuario_id`, e quatro índices;
  - a OS passa a aceitar vazio, a única mudança numa coluna existente: só relaxa a regra, e nenhuma linha muda.
- **Tabelas novas:** `os_comentarios_fotos` e `conversas_leituras`.
- **Nenhum perfil de acesso é alterado.**
- **Teste:** `sql-chat-1` roda o arquivo 2× num PostgreSQL real e compara com o Prisma.

## Fora desta leva

- **Fase 2:** áudio, vídeo e conversa técnico ↔ técnico.
- **CHAT-1.1, o próximo PR:** a foto do chat vinculada ao equipamento.

## Testes

| Arquivo | O que prova |
|---|---|
| `chat-1` (regra pura) | Lista por pessoa (ordem, iniciais) e por OS (resumo, busca, ordem); a OS padrão da mensagem (em andamento → última de hoje → Sem OS); a etiqueta que agrupa; estado de cada mensagem; juntar a fila; dia e hora de Brasília; o que se envia (texto, foto + miniatura, limites); tempo real no servidor e no navegador (marca com a leitura de quem pergunta, espera, aba escondida, espera crescente, resposta inválida, laço único); foto reduzida. |
| `chat-1-pg` (PostgreSQL real, rotas reais) | Fila do app com foto e sem duplicar, inclusive **sem OS** ("sem-os"); a foto não vai para os anexos. Lista por OS e **por pessoa**, com as não lidas; ✓✓ (quem e quando). **Para uma pessoa só** (sem e com OS), **pela OS para todos os técnicos**, o destinatário na OS. Isolamento entre técnicos; "Ver só os próprios" dentro da conversa da pessoa; outra empresa; sem "Conversas" (403); cliente escondido; OS cancelada e concluída; busca; tempo real; o endereço e o alvo de cada push. |
| `chat-1-ui` (tela do escritório) | A conversa (balões, ✓/✓✓, foto, Enter, só leitura); envio na hora, falha com "Tentar de novo" (mesmo clientId), recusa; **a chave Pessoas \| OS**; a lista de pessoas; a etiqueta da OS que agrupa e "Sem OS"; o destinatário no balão; o seletor (começa na padrão, troca em 1 toque, "Outra OS", enviar com e sem OS); abrir pela lista e pelo endereço; o ícone do topo; a conversa dentro da OS. |
| `chat-1-app` e `chat-1-app-ui` (app do técnico) | A conversa "Escritório" com as etiquetas da OS; o seletor; envio com OS (a atividade certa) e sem OS ("sem-os") pela fila; "Enviando…" e "Não enviada"; o tempo real; o contador da barra; sem sinal; abrir a OS pela etiqueta. |
| `sql-chat-1` | O SQL de produção (acima). |

**Mutação:** 16 mutantes nas regras centrais (só leitura da OS cancelada, estado da mensagem, ordem da lista, OS padrão, etiqueta que agrupa, espera do tempo real, resposta inválida, aba escondida, long-polling, quem entra na conversa do técnico, a visibilidade por OS, a gravação idempotente, o ✓✓ que não conta o autor e a permissão "Conversas"). O 1º round deixou um vivo: quem tem "Conversas" sem ver OS. O teste novo matou o mutante e achou um bug real: as rotas por pessoa exigiam "OS › Visualizar". Resultado final: 16/16 mortos.

**Ajustados (o comportamento mudou de propósito):**
- `app-campo-leva2` e `app-campo-leva2-ui`: a mensagem pode ser só foto; o card da OS virou a conversa.
- `hotfix-push-ui`: a conversa da OS agora usa o tempo real no lugar dos 20 s; continuam provados a marca da atividade, o "novo" e o erro como erro.
- `push-regras`, `push-pg`, `hotfix-push-e2e-pg`: o título "Mensagem nova na OS", e o toque abre a conversa.
- `pendencias-regras`, `pendencias-ui`: o sino leva à conversa.
- `sql-app-comentarios-os`: a produção roda o SQL antigo e o da CHAT-1.
- `tecnico-haptico`: a barra do app ganhou o Chat.

## Prints (dados fictícios)

Em `docs/prints/chat-1/` (`antes-*` × `depois-*`):
- `conversas`: não existia × a tela Conversas por pessoa (desktop e celular), com a etiqueta da OS e o seletor;
- `conversas-os`: a visão OS;
- `os-conversa`: o card de comentários × a conversa da OS, com o destinatário;
- `app-chat`: o técnico precisava abrir a OS e fazer "Cheguei" × a conversa "Escritório".
