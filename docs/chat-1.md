# CHAT-1 — Chat interno estilo WhatsApp (Fase 1)

**Objetivo de negócio:** tirar a conversa de trabalho do WhatsApp, que custa uns R$ 600/mês em chips para os técnicos, e deixar cada conversa registrada na OS. Roda em paralelo com o WhatsApp; nada foi removido.

**Não é outro sistema.** Cada conversa é a conversa de UMA OS, feita das mensagens que já existiam em `os_comentarios`: os comentários da OS, com origem APP ou ESCRITÓRIO. Essa base tem:
- `client_id`, para o envio offline não duplicar;
- `os_comentarios_lidos`, para as não lidas;
- push.

O chat evolui essa base:
- a lista de conversas;
- a tela estilo WhatsApp;
- o tempo real;
- a foto;
- o "lida" por mensagem;
- o menu Chat no app.

## O que mudou, por tela

| Onde | O quê |
|---|---|
| Escritório › **Conversas** (menu Operações e ícone com contador no topo) | Estilo WhatsApp Web. **À esquerda**, uma conversa por OS, com: nº da OS, cliente, técnicos, a última mensagem (com quem escreveu), hora, não lidas, a busca e o filtro "Não lidas". **À direita**, a conversa aberta, com balões, separador de dia, quem falou, hora e ✓/✓✓. No celular, uma coisa de cada vez, com "voltar". A conversa aberta fica no endereço (`/conversas?os=`), e é para lá que o push e o sino levam. |
| Escritório › **OS › Resumo** | O card "Comentários" virou "Conversa": é o mesmo componente da tela Conversas, com "Abrir na tela de conversas". A atualização a cada 20 s saiu; o tempo real entrou no lugar. |
| **App do técnico › Chat** (barra inferior, com contador) | A lista das conversas das OS dele: nº da OS, cliente, técnicos, última mensagem, hora, não lidas, busca e "Não lidas". Abre direto, sem entrar na OS nem fazer "Cheguei". Tem "Abrir a OS" e o mesmo balão do escritório. Dentro da execução da OS, a seção antiga ganhou "Abrir no Chat". |
| **Push** | "Mensagem nova na OS …", com o botão "Abrir conversa". Para o técnico abre `/tecnico?ver=chat&os=`; para o escritório, `/conversas?os=`. Uma OS substitui o aviso anterior da mesma OS. Quem recebe não mudou: os técnicos da OS e o escritório ligado a ela. |
| **Sino** (reserva do push) | "Mensagens novas do campo": uma só abre a conversa; várias abrem a lista de Conversas. |

## Decisões (para o Zé conferir)

1. **A foto mora numa tabela própria do chat** (`os_comentarios_fotos`), no mesmo formato e com a mesma validação dos anexos da OS: data URL no banco, conferida pelo conteúdo do arquivo.
   - **Por que não em `os_anexos`:** essa tabela alimenta a galeria, o relatório do cliente e o portal. A conversa é interna, e uma foto do chat ali correria o risco de aparecer para o cliente.
   - **Se a foto deve ir para a galeria da OS,** dá para acrescentar um botão "Levar para as fotos da OS" na Fase 2.
2. **Limite da foto: 1,5 MB depois de reduzida.**
   - O aparelho reduz a foto com o mesmo redutor do resto do sistema: corrige a orientação, lado maior de até 1600 px, JPEG 80%. Uma foto de celular de 3–8 MB costuma ficar entre 200 e 500 KB.
   - Se ainda passar do limite, reduz de novo (1280 px). Se continuar passando, avisa: "A foto passa de 1,5 MB mesmo reduzida. Tire outra ou escolha uma menor."
   - A miniatura do balão (320 px) também é feita no aparelho; a foto inteira só desce ao ampliar.
3. **"Lida" exata por mensagem.**
   - **O ✓✓:** a 1ª leitura por alguém que não o autor fica gravada na própria mensagem (`lida_em`, `lida_por_id`). A dica do ✓✓ diz "Lida por Fulano às 14:05".
   - **Por que duas colunas:** a tabela `os_comentarios_lidos` guarda só "até quando a pessoa leu a conversa", e cada leitura nova apaga a anterior. Dela não sai quando cada mensagem foi lida.
   - **O que continua em `os_comentarios_lidos`:** o contador de não lidas e o sino. Agora o técnico também grava ali, quando abre a conversa com sinal.
   - **Símbolos:** relógio = enviando, no aparelho; ✓ = no servidor; ✓✓ = lida; "Não enviada" vem com "Tentar de novo".
4. **OS cancelada:** a conversa fica só para leitura, no escritório e no app. O servidor recusa com 409, e a tela tira a caixa de escrever e mostra o motivo. **OS concluída:** a conversa continua aberta, como histórico que pode continuar.
5. **Lista do técnico:** as OS em que ele tem atividade (responsável ou na equipe), abertas, ou com mensagem nos últimos 30 dias. A cancelada sem mensagem não aparece.
6. **Começar uma conversa no escritório:** pesquisando a OS pelo número ou pelo cliente, a lista oferece "Começar conversa" nas OS que ainda não têm mensagem. Também dá pelo Resumo da OS.
7. **Contador do topo:** quantas **conversas** têm mensagem por ler, como no WhatsApp, e não quantas mensagens.
8. **"Exibir dados do cliente" desligado no app:** o nome do cliente nem sai do servidor para o técnico, na lista e na conversa.
9. **Nada de editar ou apagar mensagem** (regra que já existia).

## Tempo real: a escolha e o custo

**A escolha: long-polling curto**, sem websocket próprio, que a Vercel não mantém.

**Como funciona:**
- O aparelho pergunta "mudou algo desde a marca X?". A marca é feita da mensagem mais nova e da leitura mais nova, porque o ✓✓ também é novidade.
- O servidor segura a resposta por até **8 s**, olhando o banco a cada **2 s** (uma consulta de índice), e responde na hora em que algo muda.
- Na prática, a mensagem aparece em até cerca de 2 s.
- Há **um laço só por aba**: o ícone do topo, a lista e a conversa aberta compartilham a mesma conexão.
- **Aba escondida, ou app em segundo plano: para tudo.** Ao voltar, pergunta na hora. Fora da tela, quem avisa é o push.
- **Erro de rede:** espera 2 s, 4 s, 8 s… até 30 s.
- **Proteções:**
  - resposta sem marca válida (proxy, página de erro) conta como erro;
  - resposta rápida sem mudança espera 1 s antes da próxima, então nunca entra em laço apertado.

**Por que não SSE:** na Vercel, SSE também é uma função aberta o tempo todo, com o mesmo custo de memória. É mais frágil atrás de proxy e de rede móvel, que cortam conexões longas, e mais difícil de retomar. O long-polling curto cabe no limite de tempo da função (`maxDuration` de 20 s, com folga) e se recupera sozinho.

**O custo, numa conta grosseira para a Clima Total:**
- **Uso considerado:** 10 pessoas no escritório com o sistema aberto e 15 técnicos com o app na frente, 9 h por dia, 22 dias por mês.
- **Requisições:** cerca de uma a cada 8 s por tela aberta, o que dá ≈ 25 × (9 × 3600 / 8) ≈ **100 mil por dia**, ≈ **2,2 milhões por mês**.
- **Vercel Pro:** 1 milhão de invocações por mês está incluído; o excedente custa cerca de US$ 0,60 por milhão, ou seja, **≈ US$ 1/mês**.
- **Memória:** enquanto o pedido espera, a CPU fica parada. Com o fluid compute, várias esperas dividem a mesma instância.
- **Banco:** 4 consultas de índice por pedido, além do contador do topo quando algo muda. No horário comercial o banco já fica acordado por causa do uso normal, então o custo extra é pequeno.
- **Comparação:** custo ordem de grandeza menor que os R$ 600/mês de chips.

## Offline no app

- **Envio:** é pela **fila** que o app já usa, com a operação "comentario", agora também com foto e miniatura.
- **Sem sinal:** a mensagem aparece na hora como "Enviando…" e sobe sozinha quando o sinal volta. O `clientId` faz o reenvio não duplicar, também no escritório.
- **Recusada pelo servidor** (ex.: OS cancelada): aparece "Não enviada" com o motivo e "Tentar de novo".
- **Lida sem sinal:** a lista e a última conversa ficam guardadas no aparelho, com o aviso de que são da última sincronização.
- **Limitação que já existia:** a fila é em ordem por atividade. Uma mensagem recusada segura as gravações seguintes daquela atividade até "Tentar de novo" ou "Descartar", que fica no Perfil.

## Permissões e isolamento

- **Escritório:**
  - ler pede "OS › Visualizar"; escrever pede "OS › Editar" (a tela avisa sem a caixa de escrever, e o servidor responde 403);
  - vale o "Ver só os próprios" da COM-1: fora do escopo, a conversa não aparece e responde 404, inclusive a foto;
  - quem está no modo técnico usa o app (403 nas rotas do escritório).
- **Técnico:** só as OS em que tem atividade. A OS de outro técnico responde 404, e escrever por uma atividade que não é dele é recusado.
- **Multiempresa:** tudo filtrado pela empresa da sessão.

## SQL 🔵

`prisma/sql/2027-02-20_chat_1.sql`: aditivo e idempotente, sem mudar linha existente.
- **`os_comentarios`:** ganha `lida_em` e `lida_por_id`, e dois índices, para a lista e para o tempo real.
- **Tabela nova `os_comentarios_fotos`.**
- **Teste:** `sql-chat-1` roda o arquivo 2× num PostgreSQL real e compara com o Prisma.

## Fora desta leva (Fase 2)

Áudio, vídeo e conversa sem OS.

## Testes

| Arquivo | O que prova |
|---|---|
| `chat-1` (regra pura) | Resumo e busca da lista (sem acento e sem caixa), ordem, OS cancelada, estado de cada mensagem, juntar a fila com o servidor, dia e hora de Brasília, o que se envia (texto, foto + miniatura, limites). Tempo real no servidor (marca, espera, cancelamento) e no navegador (um laço por aba, aba escondida, espera crescente, resposta inválida, laço único ao sair e entrar). Foto reduzida no aparelho. |
| `chat-1-pg` (PostgreSQL real, rotas reais) | Envio pela fila com foto e reenvio sem duplicar; a foto não vai para os anexos. Lista com as não lidas; abrir grava o ✓✓ (quem e quando); escritório idempotente; técnico lê e o escritório ganha o ✓✓. Foto inteira só para quem vê. Isolamento entre técnicos, "Ver só os próprios", outra empresa, sem permissão. Nome do cliente escondido. OS cancelada e concluída. Busca com "começar conversa". Tempo real (mensagem e leitura; o técnico só sente as OS dele). O endereço do push. |
| `chat-1-ui` (tela do escritório) | Balões, ✓/✓✓ com quem leu, foto que amplia, Enter envia, foto escolhida antes de enviar, só leitura e sem permissão. Envio na hora, falha de rede com "Tentar de novo" (mesmo clientId), recusa volta à caixa, tempo real recarrega. A tela Conversas (lista, "Não lidas", busca no servidor, abrir com ?os=, voltar no celular, contador zerado da aberta). O ícone do topo. A conversa dentro da OS. |
| `chat-1-app` e `chat-1-app-ui` (app do técnico) | Lista, busca e "Não lidas"; abrir sem entrar na OS; a mensagem sem sinal entra na fila com a atividade certa e mostra "Enviando…"; recusada com "Tentar de novo"; o tempo real; lista e conversa guardadas sem sinal; OS cancelada; OS de outro técnico; o contador na barra; o push abrindo direto. |
| `sql-chat-1` | O SQL de produção (acima). |

**Ajustados (o comportamento mudou de propósito):**
- `app-campo-leva2` e `app-campo-leva2-ui`: a mensagem pode ser só foto; o card da OS virou a conversa.
- `hotfix-push-ui`: o card agora usa o tempo real no lugar dos 20 s; continuam provados a marca da atividade, o "novo" e o erro como erro.
- `push-regras`, `push-pg`, `hotfix-push-e2e-pg`: título "Mensagem nova na OS", e o toque abre a conversa.
- `pendencias-regras`, `pendencias-ui`: o sino leva à conversa.
- `sql-app-comentarios-os`: a produção roda o SQL antigo e o da CHAT-1.
- `tecnico-haptico`: a barra do app ganhou o Chat.

## Prints (dados fictícios)

Em `docs/prints/chat-1/` (`antes-*` × `depois-*`):
- `os-conversa`: o card de comentários no fim da OS × a conversa com balões;
- `conversas`: não existia × a tela Conversas (desktop e celular), com o ícone no topo;
- `app-chat`: o técnico precisava abrir a OS e fazer "Cheguei" × a lista do Chat;
- `app-conversa`: a conversa aberta no app.
