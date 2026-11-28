# CHAT-1.1 — Responder uma mensagem e a foto do chat no equipamento

**Sobre o CHAT-1** (`docs/chat-1.md`, já em produção). Dois acréscimos pedidos pelo Zé:
- **(a)** a foto do chat vinculada ao equipamento;
- **(b)** responder uma mensagem específica, como no WhatsApp.

Também a resposta à pergunta do armazenamento das fotos: os números e a proposta estão em `docs/armazenamento-fotos.md`.

**Regra de produto (confirmada pelo Zé): mensagem NUNCA se edita nem se apaga, nem pelo técnico nem pelo escritório.**
- Vincular ou corrigir o equipamento de uma foto, e pô-la no relatório, NÃO muda a mensagem (o texto e a foto ficam iguais).
- É um dado ao lado dela, e cada mudança fica no histórico da OS.
- A rota da foto só aceita o equipamento ou o relatório; texto é recusado.

## (b) Responder uma mensagem

**Como se responde:**
- **App:** arrastar o balão para a direita, ou o toque longo, que abre o menu "Responder".
- **Escritório:** o ícone Responder aparece ao passar o mouse no balão; o botão direito abre o mesmo menu.

**A citação:**
- **Acima do campo de texto:** quem falou e um trecho de uma linha, ou a miniatura se for foto, com um X para cancelar. Esc também cancela no computador.
- **No balão da resposta:** a citação aparece no topo. Tocar nela rola até a mensagem original e a destaca por um instante.
- **Original antiga:** se ela não está entre as carregadas (a conversa traz as 300 mais recentes; a da OS, as 500), a tela pede a conversa desde ela (`?ate=`, até 2.000 mensagens) e vai até ela.

**A OS da resposta:** a resposta herda a OS da mensagem citada, e não a da atividade em andamento.
- A pessoa ainda troca no seletor. Cancelar a citação volta à OS de antes, se a pessoa não tinha trocado.
- **No app,** a mensagem sobe pela atividade do técnico. Uma OS de outro dia entra no seletor pela atividade dele nela, que vem com a conversa. Se o técnico não tem atividade naquela OS, a resposta vai "Sem OS", com a citação mostrando de onde veio.

**Dentro da OS:** a citação aparece igual, no escritório e no app. No app, responder é pelo Chat; dentro da OS, a lista mostra a citação.

**Offline:** a referência vai na fila, pelo id da citada ou, se ela ainda está "Enviando…", pelo `client_id` dela.
- A fila sobe em ordem, então a citada chega antes, e o vínculo fica.
- Se a citada nunca chegou (foi recusada e descartada no aparelho), a resposta grava sem a citação, para não travar a fila.
- Reenviar a mesma resposta não duplica.

**Quem pode citar o quê:**
- só uma mensagem que a pessoa pode ver, na mesma conversa ou OS;
- **técnico:** a conversa dele e as OS em que tem atividade;
- **escritório, pela OS:** só mensagens daquela OS;
- **escritório, pela conversa da pessoa:** só a conversa dela, dentro da permissão de OS e do "Ver só os próprios";
- outra empresa nunca;
- fora disso: 404, nada gravado.

**Quem lê:** se quem lê não pode ver a original, a citação aparece como "Mensagem indisponível", e o conteúdo da original não sai do servidor.

**Fora desta leva:** reações com emoji, encaminhar, editar e apagar. A mensagem recusada ("Não enviada") não se responde.

## (a) A foto do chat no equipamento

**A regra:** toda foto nasce ligada à OS da mensagem; sem OS, não há equipamento. Dentro da OS, o equipamento sai NESTA ordem, sem IA:

| # | Regra | Origem gravada |
|---|---|---|
| 1 | A OS tem UM equipamento → ele | `UNICO` |
| 2 | (app) O técnico tem uma atividade EM ANDAMENTO nesta OS ligada a um equipamento → ele. Entre vários, o único ainda não atendido. | `ANDAMENTO` |
| 3 | (app) O QR code Frivo aparece na foto, lido NO APARELHO com o leitor que o app já usa (`lerQrDaFoto`) → o equipamento dele, só se for da mesma empresa e do mesmo cliente da OS, e ativo (vale até se ainda não estiver na OS). De outro cliente: fica como SUGESTÃO, sem vincular ("QR de outro cliente: …"). De outra empresa: nada. | `QR` |
| 4 | Vários e nada indica → quem envia escolhe nos chips (os equipamentos da OS e "Sem equipamento"); sem escolha, fica sem e pode ser vinculada depois | `ESCOLHA` (ou nada) |

**Regras de aplicação:**
- **A escolha explícita** de quem envia vale acima das automáticas, porque é quem está vendo o equipamento. "Sem equipamento" também é escolha.
- **A foto do escritório** segue só as regras 1 e 4.
- **O servidor decide.** A caixa de escrever mostra a mesma decisão antes de enviar (os chips já marcados, com o porquê), com o que o aparelho sabe.

**No balão:** uma etiqueta discreta embaixo da foto, com o equipamento e o porquê na dica. Aparece também "QR de outro cliente: …" quando há sugestão, e "No relatório" quando a foto está no relatório.

**Corrigir ou tirar o vínculo:**
- **Como:** tocar na etiqueta, ou o menu do balão "Equipamento da foto", abre os chips da OS.
- **Escritório:** pela rota `PATCH /api/conversas/mensagens/[id]/foto` `{ equipamentoId }`. Pede quem edita a OS, dentro do "Ver só os próprios".
- **Técnico:** pela fila do app (`fotoChatEquipamento`), também sem sinal e pelo `clientId` da foto ainda na fila, pela atividade dele naquela OS. Foto de OS em que ele não tem atividade no aparelho: o escritório corrige.
- **A trilha:** cada mudança fica no histórico da OS ("Foto do chat vinculada ao equipamento" / "Equipamento da foto do chat corrigido" / "Vínculo da foto do chat removido"), com de → para, quem, de qual foto, e "(app do técnico)".
- **O mesmo de novo** não registra nada (idempotente).
- **Equipamento de fora da OS:** recusado (422).

**O histórico do equipamento** mostra a foto (por referência, servida pela rota da foto do chat, que confere quem vê). Ela fica na atividade de onde o técnico escreveu; a do escritório, na 1ª atividade da mesma OS.

**O relatório da atividade:**
- O escritório põe a foto lá ("Mostrar no relatório", no menu do balão), por REFERÊNCIA: o relatório lê a foto da própria mensagem, e nada é copiado para os anexos.
- **Decisão: por padrão a foto do chat fica FORA do relatório.** A conversa é interna ("o cliente não vê"); pôr no relatório é uma escolha do escritório, registrada no histórico da OS.
- Entra como as "Fotos do serviço": no bloco do equipamento atendido; senão, gerais, com o nome dele.
- A foto que o escritório enviou pelo chat (sem atividade) não entra, como os anexos do escritório hoje.

**Offline:** a escolha e o QR lido vão na fila com a foto; o servidor decide na hora de gravar. A fila reenvia sem duplicar nem mudar o vínculo.

## As fotos e o banco

**Medido:** uma foto típica de trabalho fica com ~0,5 MB no banco, e o limite aplicado é 1,5 MB comprimida (~2 MB de texto). Com ~60 fotos por dia, são ~810 MB por mês.

**Garantido por teste** (`chat-1-1-fotos-pg`): nenhuma listagem, conversa, tempo real, sino ou retrato lê a foto inteira (`os_comentarios_fotos.conteudo`); só a rota de ampliar.

**A proposta** de levar fotos e anexos para um armazenamento de arquivos (custo, migração em fases e fallback) está em `docs/armazenamento-fotos.md`. É uma decisão do Zé, e nada foi implementado.

**Visto de passagem, de antes desta leva:** o portal do cliente, na tela de um chamado, carrega todos os anexos da OS com o conteúdo inteiro. Entra na mesma proposta.

## SQL 🔵

`prisma/sql/2027-02-27_chat_1_1.sql`, aditivo e idempotente. Roda depois do `2027-02-20_chat_1.sql`, que já está aplicado.
- **`os_comentarios.resposta_a_id`:** a mensagem que esta responde, com chave para a própria tabela e SET NULL só por segurança.
- **`os_comentarios_fotos`:**
  - `equipamento_id`;
  - `equipamento_origem`;
  - `equipamento_sugerido_id`;
  - `no_relatorio` (falso por padrão);
  - um índice (empresa, equipamento) e as chaves para `equipamentos` (SET NULL).
- **Linhas existentes:** nenhuma muda. Nada é apagado; nenhum perfil de acesso é alterado.
- **Teste:** `sql-chat-1-1` roda o arquivo 2× num PostgreSQL real e compara com o Prisma.

## Testes

| Arquivo | O que prova |
|---|---|
| `chat-1-responder` (regra pura) | O envio da referência (id OU clientId, nada além; citar não dispensa o conteúdo); a recusada não se responde; o trecho de uma linha e "Foto"; achar a citada; a fila guarda só a referência e a citação vem da conversa; a OS herdada (e, no app, a de outro dia pela atividade dele). |
| `chat-1-responder-pg` (PostgreSQL real) | <ul><li>O app responde pela fila com a OS da citada, sem duplicar.</li><li>Sem sinal, cita a que está na fila e as duas sobem em ordem; a citada que nunca subiu não trava a fila.</li><li>Permissão: a OS de outro técnico, a conversa de outra pessoa, "Ver só os próprios", outra empresa (404, nada gravado); pela OS, só da mesma OS.</li><li>"Mensagem indisponível" para quem não vê a original.</li><li>`?ate=`.</li></ul> |
| `chat-1-responder-ui` e `chat-1-app-ui` | <ul><li>Computador: o ícone e o botão direito.</li><li>Celular: arrastar (pouco não; rolar a conversa não) e o toque longo (sem abrir a foto).</li><li>A citação acima do campo, X e Esc; o envio com a referência.</li><li>A citação no balão leva até a original e a destaca; a antiga carrega desde ela.</li><li>A OS herdada e cancelar que volta; a conversa só leitura não responde.</li><li>No app: a fila com a referência, Sem OS, a OS de outro dia, sem sinal.</li></ul> |
| `chat-1-1-equipamento` (regra pura) | As 4 regras em ordem; a escolha acima das automáticas; QR de outro cliente sugere; o escritório só 1 e 4; a atividade em andamento; a trilha (de → para); a fila mostra a escolha e a correção na hora. |
| `chat-1-1-equipamento-pg` (PostgreSQL real) | <ul><li>As 4 regras pela fila; QR de outro cliente e de outra empresa; a foto do escritório.</li><li>Offline sem duplicar.</li><li>Corrigir pelo escritório e pela fila, com a trilha e idempotente; equipamento de fora da OS.</li><li>Isolamento: outra empresa, "Ver só os próprios", sem editar, outra técnica de outra OS.</li><li>A rota não edita texto; só PATCH.</li><li>O relatório por referência (só a marcada, nada copiado; tirar, sai).</li><li>O histórico do equipamento; os equipamentos de cada OS na conversa.</li></ul> |
| `chat-1-1-equipamento-ui` | A etiqueta (o porquê, QR de outro cliente, no relatório); corrigir pela etiqueta e pelo menu; o erro; "Mostrar no relatório"; os chips da caixa por regra (único, em andamento, QR, vários) e o envio; o escritório pela rota; só leitura e sem editar não corrigem. |
| `chat-1-1-fotos-pg` | Nenhuma rota de lista ou tempo real lê a foto inteira (registro de TODO SQL); o peso da conversa é o das miniaturas; a rota de ampliar lê (o controle). |
| `sql-chat-1-1` | O SQL de produção (acima). |
