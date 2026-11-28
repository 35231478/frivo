# App pronto pra janeiro — varredura do app do técnico de ponta a ponta

**Objetivo:** em janeiro a equipe da Termofrio usa o app de verdade. Antes disso, caçar toda ponta solta.

## Como foi feito

- **Quem:** um técnico novo de outra empresa, sem tutorial. Ele percorre um dia inteiro no celular: iPhone (390 px) e
  Android (360 px).
- **Empresa:** demo fictícia ("Polar Climatização"), com banco **local**. A produção não foi consultada.
- **O dia do técnico:** checklist do veículo obrigatório e 5 OS fictícias:
  - uma corretiva;
  - uma preventiva PMOC com 3 equipamentos, feita com outro técnico;
  - uma visita que o escritório **reagenda** no meio do dia;
  - uma instalação que o escritório **cancela**;
  - uma atividade de ontem esquecida em andamento.
- **Com e sem sinal:** cada caminho rodou também sem sinal, com a sessão vencida e com "um aparelho só".
- **Auditoria automática em cada tela:**
  - alvos de toque abaixo de 44 px;
  - texto cortado;
  - rolagem lateral;
  - erros do console;
  - respostas HTTP com erro.
- **Leitura de código:** completou o que não dá para reproduzir num navegador de teste, como a câmera lendo um QR de
  verdade.

**Conversa da OS e push:** não mexi (a CHAT-1 está refazendo). Ficou só o registro, no fim.

Prints antes e depois: `docs/prints/janeiro/` (iPhone e Android, as mesmas 9 cenas, nesta ordem):
1. login depois da sessão vencida;
2. checklist do veículo com o item OK/NOK salvo sem opções;
3. Meu dia;
4. Minhas comissões;
5. progresso do equipamento;
6. excluir a foto antes;
7. despesa com o que falta;
8. OS cancelada;
9. Perfil com a OS cancelada depois do trabalho sem sinal.

## Tabela: tela × problema × gravidade × corrigido?

Gravidade:
- **Alta:** prende o técnico ou faz perder trabalho sem aviso.
- **Média:** confunde ou leva a erro.
- **Baixa:** atrito.

| # | Tela | Problema encontrado | Grav. | Corrigido? / decisão |
|---|---|---|---|---|
| C1 | Fila / login | **Sessão vencida com gravações no aparelho:** a API do app redirecionava para o login (HTML). O app quebrava ao ler a resposta e nunca dizia "Entre de novo". Ao navegar, caía no login sem explicar ("Acesse o painel de gestão"). | Alta | ✅ API do app sem sessão → 401. O app reconhece também o redirecionamento antigo. O login diz: "Sua sessão expirou. Entre de novo: o que você fez sem sinal continua guardado no aparelho e sobe depois." |
| C2 | Checklist do veículo | Item OK/NOK salvo **sem opções** (o editor e a API deixavam) aparecia **sem nenhum botão**. Sendo obrigatório, o técnico ficava preso: só "Hoje não vou usar". | Alta | ✅ Item de opção sem opções vale "OK, NOK" (no app e na regra do alerta). |
| C3 | Configurações › Modelo de checklist | A regra "a 1ª opção é a saudável" estava só no ⓘ dos itens, sem exemplo. Com "Baixo, Médio, Cheio", responder "Cheio" virava alerta ("Checklist registrado com alertas" com tudo certo). | Baixa | ✅ O mesmo ⓘ (padrão: não repete embaixo de cada item) ganhou o exemplo ("Cheio, Médio, Baixo", e não "Baixo, Médio, Cheio") e o "sem opções, vale OK, NOK". |
| C4 | Checklist do veículo → Meu dia | O dia só baixava **depois** do checklist. Quem abriu o app com sinal e fez o checklist na garagem sem sinal ficava com "Sem sinal e nada guardado ainda". | Média | ✅ O dia desce em segundo plano enquanto o checklist está na tela. |
| C5 | OS / equipamento | OS **cancelada** pelo escritório abria com "Atividade **concluída**. Só leitura." | Média | ✅ "Atividade cancelada pelo escritório. Só leitura: se precisar voltar a ela, fale com o escritório." (faixa de atenção) |
| C6 | Equipamento | Progresso "**0 de 19**" e botão "**Faltam 18**": o ΔT, que o app calcula sozinho, entrava no total. | Média | ✅ O progresso conta os mesmos itens das pendências. |
| C7 | Despesa de campo | "Lançar" cinza **sem dizer o que falta** (ex.: escolher "Do meu bolso / Cartão da empresa"). | Média | ✅ Embaixo do botão: "Falta: quem pagou e a foto do cupom." |
| C8 | Fotos antes/depois, cupom, etiqueta | **Um toque no X apagava a foto**, sem pergunta e sem desfazer. | Baixa | ✅ Pergunta "Excluir foto?" (as fotos do serviço já perguntavam e não perguntam duas vezes). |
| C9 | Meu dia (360 px) | Nome do cliente e "OS · serviço · unidade" **cortados com "…"** ("Padaria Pão Dourado (…"). | Baixa | ✅ Até 2 linhas. |
| C10 | Meu dia › Minhas comissões | Tocar no card abria o Perfil com a seção **fechada**, e escondida sem sinal. | Baixa | ✅ Abre aberta (e aparece também sem sinal: quem tem o card tem comissão). |
| C11 | Login, troca de senha, checklist do veículo | **Alvos < 44 px:** campos com 42 px; "Esqueci minha senha", 16 px; olho da senha, 16 px; Baixo/Médio/Cheio, 38 px; "Hoje não vou usar", 36 px. Campos com letra de 14 px fazem o **iPhone dar zoom**. Subtítulo "Acesse o painel de gestão" para o técnico. | Baixa | ✅ 44 px e letra de 16 px. Subtítulo "Painel de gestão e app do técnico". |
| C12 | Meu dia | Visita/instalação mostrava o chip "**0 equipamentos**". | Baixa | ✅ O chip some quando é zero. |
| C13 | OS › Ler QR | QR de equipamento **de outro cliente**: o app dizia "QR enviado: o escritório confere"; o servidor recusava, e a recusa **travava todas as gravações seguintes da OS** até o técnico achá-la no Perfil. | Média | ✅ QR recusado não trava mais o resto do serviço (a recusa continua no cabeçalho e no Perfil). |
| C14 | Perfil › Sincronização | OS cancelada depois do trabalho feito sem sinal: 1 recusada e "N a enviar" presas, **descartadas uma a uma**, cada uma voltando recusada. | Média | ✅ "Descartar todas desta OS (N)", com confirmação. O que já subiu e o de outra OS ficam. |

## Decisões de produto (com a minha recomendação)

| # | Tela | O que falta | Recomendação |
|---|---|---|---|
| D1 | OS | **Não existe pausa nem impedimento** (falta peça, cliente ausente, acesso negado). Só "Marcar como não atendido" por equipamento. | Leva própria: "Pausar / Impedimento" com motivos + "Retomar"; o escritório vê o motivo. **Prioridade para janeiro.** |
| D2 | Login | Sem "Manter conectado", a sessão vale **1 dia**. No dia seguinte o técnico pega o celular e a fila fica parada até ele entrar de novo (agora o app avisa, C1). | Login do app do técnico valer 30 dias (ou "Manter conectado" já marcado no celular). Decisão de segurança: Zé. |
| D3 | Meu dia | **"A caminho" e "Cheguei" não têm desfazer** (o cliente já foi avisado). | Manter; o escritório corrige o horário. |
| D4 | Equipamento | **Fotos antes/depois sem legenda** (as do serviço têm). | Legenda opcional, como nas fotos do serviço. |
| D5 | Materiais | **Saldo não aparece**; sem saldo o material é lançado e o estoque fica negativo. | Mostrar o saldo do veículo e deixar lançar com aviso (decisão de estoque). |
| D6 | Aceite | App instalado travado em retrato; quadro de assinatura de 176 px de altura. | Botão "Assinar em tela cheia" (paisagem só nessa tela). |
| D7 | Despesas | **Sem editar nem excluir** depois de lançar. | Editar/excluir enquanto o gestor não viu. |
| D8 | 1º acesso | Nada oferece **instalar na tela de início** (no app do técnico; no iPhone é manual) nem **ativar as notificações** (só no Perfil). | Cartão único no Meu dia nos primeiros dias: "Instale o app e ative as notificações", com o passo do iPhone ("Compartilhar › Adicionar à Tela de Início"). |
| D9 | Meu dia | OS **cancelada ou reagendada some** do dia sem aviso. | Faixa "Saiu do seu dia: OS-2604 (cancelada pelo escritório)". |
| D10 | Equipamento | A **corretiva pede o checklist inteiro da preventiva** (19 itens) para um "split não gela". | Checklist por tipo de OS (corretiva mais curta). Decisão técnica: especialista. |
| D11 | "Um aparelho só" | O aparelho antigo explica ("entrou em outro aparelho"), mas o que ficou nele só sobe entrando nele, e isso derruba o novo. | Avisar no aparelho novo que há gravações no antigo. |
| D12 | Fila | **Só envia com o app aberto** (o navegador não tem envio em segundo plano confiável no iPhone). | Manter; o aviso "Instale o app…" já existe no Perfil. |
| D13 | Checklist do veículo | Checklist **feito não pode ser corrigido** no dia. | Corrigir até o fim do dia. |
| D14 | PMOC | Equipamento começado conta como "atendido" ("1 de 3 atendidos" com "Faltam 9"). | "1 começado · 0 completos". |
| D15 | Todas | **Voltar do Android** com a câmera aberta fecha a câmera e sai do equipamento; com um modal aberto, volta a vista anterior. | Leva própria: o voltar fecha só a camada de cima (mexe em todos os modais). |

## Verificado e sem problema

- **1º acesso:** a senha provisória obriga a troca. As 3 mensagens são claras: senha fraca, confirmação diferente e
  igual à recebida.
- **Checklist do veículo:**
  - "Hoje não vou usar" tem motivo e o atalho "Fazer checklist do veículo" depois;
  - sem sinal, fica no aparelho e sobe sozinho.
- **Meu dia:**
  - ordem por horário;
  - "Começadas antes — falta concluir" no topo;
  - "Como chegar";
  - "Sem endereço no cadastro" quando falta.
- **A caminho e Cheguei:**
  - "A caminho" com WhatsApp;
  - "Cheguei" abre direto o equipamento.
- **No equipamento:**
  - câmera do app;
  - medição fora da faixa avisa sem travar;
  - TUDO OK;
  - busca de material.
- **Conclusão:** um duplo toque não conclui duas vezes.
- **Aceite e relatório:**
  - aceite com assinatura e "Confirmado por…";
  - relatório por WhatsApp para o número do cliente;
  - relatório em PDF.
- **"Um aparelho só":** o login explica "esta conta entrou em outro aparelho".
- **Dois técnicos na PMOC** veem o mesmo andamento (o "Cheguei" de um aparece no outro).
- **Offline:**
  - mostra "Offline · N" e sobe quando o sinal volta;
  - o app instalado aberto sem sinal cai no /offline, que leva ao Meu dia guardado.
- **Erro "reading 'waiting'"** no console dos testes: é do navegador de teste, com o service worker bloqueado. Não é
  do app.

## Conversa da OS e push (só registro; a CHAT-1 está refazendo)

- **Entradas:** botão "Comentários" na OS e contador de novos no cartão do Meu dia.
- **Notificações:** ativação só em Perfil › "Ativar notificações neste aparelho". O app não pede sozinho (ver D8).

## Testes desta leva

- **Regras (`janeiro-regras`, 12):**
  - sessão sem login;
  - opções do item;
  - alerta;
  - faixa de só leitura;
  - progresso;
  - o que falta na despesa;
  - vista do Perfil.
- **Offline (`janeiro-offline`, 9):** IndexedDB e motor de verdade:
  - sessão vencida pelo redirecionamento;
  - portal de Wi-Fi;
  - QR recusado não trava;
  - outra recusa trava;
  - descartar as da OS sem levar o que subiu nem o de outra OS.
- **Telas (`janeiro-app-ui`, 13):**
  - excluir foto pergunta;
  - login depois da sessão vencida;
  - alvos e campos de 16 px;
  - item OK/NOK sem opções.
- **PostgreSQL real (`checklist-diario-pg`, +1):** item sem opções, "OK" saudável e "NOK" com alerta, pela rota de
  verdade.
- **Mutação:** 30 mutantes, 30 mortos. Os 2 que sobreviveram na 1ª rodada viraram prova.
