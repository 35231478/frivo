# CHAT-1.2 — situação e presença do técnico (o que o escritório vê)

**O pedido (aprovado pelo Zé):** para técnico de campo, "online" sozinho diz pouco. O que importa é o que ele está fazendo e se a mensagem vai chegar.

## 1. A linha de situação

**Onde:** embaixo do nome de cada pessoa, na lista Pessoas, e no cabeçalho da conversa. É UMA linha, derivada do que o sistema já sabe.

**A prioridade:**

| # | Situação | De onde vem |
|---|---|---|
| 1 | **Pausada — \<motivo\>** · OS-N | a atividade em andamento dele com a pausa aberta (`atividade_pausas`, #299) |
| 2 | **Em execução** · OS-N | a atividade em andamento (a iniciada por último) |
| 3 | **A caminho** · OS-N | "A caminho" avisado HOJE numa atividade ainda não iniciada, sem "Cheguei" nela |
| 4 | **Fora do expediente** | nada acima, e a hora está fora da jornada dele (as faixas do cadastro) |
| 5 | **Sem atividade agora** | nada acima, dentro da jornada |

**Decisões:**
- **Pausada × em execução:** se ele tem OUTRA atividade em andamento sem pausa, vale "Em execução". Uma pausa esquecida de ontem não esconde o serviço de agora. Com duas pausadas, vale a pausa mais recente.
- **A jornada:** o intervalo do almoço conta como dentro do expediente. Sem jornada cadastrada, nunca aparece "Fora do expediente", porque não dá para dizer. O horário antigo (entrada, saída e dias) também vale.
- **A atividade pela equipe** (2º técnico ou composição) conta como dele, a mesma regra do "Meu dia".
- **O nº da OS:**
  - No cabeçalho, ele é um link para a OS.
  - Na lista, ele aparece como texto: a linha inteira já é o botão que abre a conversa, e um link dentro de botão é HTML inválido e ruim para o leitor de tela.
  - Com "Ver só os próprios", a OS que a pessoa não pode abrir não aparece.

## 2. A presença

**A fonte:** `usuarios.ultimo_contato_em`.
- **Quando é gravada:** quando o app fala com o servidor, por três caminhos que já existiam:
  - o tempo real do chat, a cada poucos segundos com o app aberto;
  - a sincronização;
  - a localização.
- **No máximo 1 gravação por minuto por usuário:**
  - dentro do minuto, o servidor nem pergunta ao banco: a última gravação fica na memória;
  - o próprio UPDATE só grava se a data guardada tem mais de 1 minuto, caso outra instância do servidor já tenha gravado;
  - nunca escreve a cada requisição.

**O que aparece:**

| Caso | Na tela |
|---|---|
| contato nos últimos 2 minutos | **ponto verde** no avatar (nome acessível: "No app agora"), sem texto |
| mensagem do escritório esperando por ele, e 10 min ou mais sem contato (até 24 h) | **"Sem sinal há N min"** (ou "há N h"); a dica diz que a mensagem fica esperando e chega quando o sinal voltar |
| o resto | **"visto por último às HH:MM"** (hoje), **"visto por último ontem"** ou **"visto por último em DD/MM"** |
| nunca falou com o servidor depois desta leva | nada |

"Mensagem esperando" quer dizer que a última mensagem da conversa é do escritório e ele ainda não leu.

## 3. Quem vê

- **Só o escritório com a permissão "Conversas":** na lista, no cabeçalho e no tempo real.
- **"Ver só os próprios":** a pessoa vê a situação, mas o nº da OS só das OS que ela pode abrir.
- **O técnico NÃO vê** quem do escritório está online (decisão de produto: a conversa dele é com "o Escritório"):
  - as respostas do app não trazem presença nem situação de ninguém;
  - as rotas do escritório recusam o técnico (403).
- **Multiempresa:** cada empresa só vê os próprios técnicos.
- **Sem localização exata** nesta linha: isso é do mapa.

## 4. Sem texto demais

- É uma linha só.
- **Cor:** só o ponto verde e a pausa por **impedimento** têm cor. A pausa de almoço não tem.
- **A legenda** fica no ⓘ, no cabeçalho da conversa e ao lado dos filtros da lista.
- **Quando falta espaço**, nesta ordem:
  1. o "visto por último" sai primeiro;
  2. depois a situação encolhe, com reticências; o texto inteiro fica na dica;
  3. o nº da OS nunca se corta.

## 5. Tempo real e custo

**Como atualiza:**
- A situação e a presença vêm pelo MESMO canal de tempo real do chat (`/api/conversas/novidades`), em cada resposta, sem recarregar a lista.
- A tela recalcula "visto por último" e o ponto com um relógio local, a cada 30 s, sem consulta.

**As consultas, medidas em PostgreSQL real** (`chat-1-2-pg`, 6 técnicos):

| | Antes | Depois |
|---|---|---|
| A lista Pessoas | 16 | **17**: só a consulta da situação, uma para todos os técnicos |
| Tempo real, a cada resposta | só a marca e o contador | **+3** (técnicos, logins e a situação), no máximo a cada 15 s por pessoa do escritório; dentro dos 15 s, nenhuma |

- **A situação de todos sai de UMA consulta SQL.** Pelo Prisma seriam várias: uma por relação (equipe, OS, pausa, avisos).
- **A contagem do ícone do topo** não lê a situação.
- **O laço do tempo real** (3 agregados por passo) não mudou.

## 6. Dados

**🔵 SQL** `prisma/sql/2027-03-01_chat_1_2_presenca.sql`, aditivo e idempotente:
- uma coluna nova, opcional, sem valor padrão e sem índice: `usuarios.ultimo_contato_em`;
- a leitura é pela chave;
- nada existente muda.

## Testes

**Regras puras e tela** (`chat-1-2`):
- cada situação e a prioridade;
- a jornada: fim de semana, almoço, sem jornada, horário antigo, faixa noturna;
- a presença: 2 min, ontem, data, sem sinal só com mensagem esperando, de 10 min a 24 h;
- a linha: o link só no cabeçalho, o ponto, a cor só no impedimento, sem "você".

**PostgreSQL real** (`chat-1-2-pg`):
- as cinco situações lidas do banco, com a equipe e o "Cheguei";
- o contato gravado pelos três caminhos;
- no máximo 1 gravação por minuto, também sem a memória (outra instância);
- o tempo real e o cabeçalho;
- a pausa retomada;
- a permissão, o "Ver só os próprios" e o técnico sem presença;
- outra empresa;
- as consultas.

**A tela inteira** (`chat-1-ui`):
- a linha e o ponto na lista e no cabeçalho;
- o tempo real atualiza sem recarregar a lista.

**O SQL** (`sql-chat-1-2`): o arquivo rodado 2× num PostgreSQL real e comparado com o Prisma.

**Mutação:** 23/23 mutantes mortos.
