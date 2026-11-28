# Hotfix — o chat no iPhone (PWA instalado)

**O relato:** o Zé testou no iPhone, com o app instalado na tela de início. Ele mandou o print do Chat › "Escritório" com três problemas:
- a barra inferior (Meu dia · Agenda · Chat · Perfil) ficava POR CIMA do rodapé da conversa, cortando os chips da OS e o campo de escrever;
- um balão recebido aparecia sem o nome de quem escreveu;
- as mensagens do técnico ficavam só com ✓, horas depois de o escritório responder.

## 1. A barra por cima do rodapé

**A causa:**
- A tela Chat tinha a altura fixa `100dvh − 8rem − safe-area-inset-bottom`, uma conta que supunha um topo de 4rem.
- No iPhone instalado, o topo ganha a área do relógio (`safe-area-inset-top`, ~47–59 pt). Ganha também a faixa de localização quando o rastreamento está ligado.
- O topo real ficava maior que o suposto, e a conversa descia essa diferença para trás da barra.

**A correção:**
- **O topo e a barra são MEDIDOS** como estão desenhados (`--tec-topo` e `--tec-barra`, atualizados quando mudam). As áreas do relógio e do gesto de início, e a faixa de localização, entram sozinhas.
- **A tela Chat é uma camada fixa** exatamente entre os dois. A lista de mensagens termina acima do rodapé e rola até a última.
- **As outras telas do app** também terminam acima da barra: o fim da página usa a altura medida dela, não mais `pb-28`. Isso vale para a conversa dentro da OS.

## 2. O teclado

**A causa:** no iOS, e no Chrome do Android por padrão, o teclado não encolhe a página: encolhe só a área visível (`visualViewport`).

**A correção:**
- A tela Chat usa a altura VISÍVEL, e também o quanto o iPhone rolou a página ao abrir o teclado. O campo de escrever fica logo acima do teclado.
- A conversa rola para a última mensagem ao focar o campo e quando a área encolhe, se a pessoa estava no fim.

**Decisão: a barra inferior SOME com o teclado aberto.**
- Ela não serve para nada enquanto se digita, e ocuparia ~60 pt de uma tela que, com o teclado, já fica pequena.
- Volta ao fechar o teclado.

**O que conta como "teclado aberto":**
- a área visível encolheu mais de 120 pt;
- há um campo de texto em foco;
- não é zoom de pinça.

A barra de endereço que some e aparece não conta.

## 3. O balão sem o nome

**A causa:** o nome se escondia sempre que a mensagem anterior era do mesmo autor, mesmo com a etiqueta de OUTRA OS no meio, ou horas depois. O "Opa" do print veio depois da etiqueta de outra OS, da mesma pessoa do escritório.

**A regra nova:** todo balão recebido mostra quem escreveu e de onde ("Ana Souza · escritório"). O nome só se omite numa sequência IMEDIATA do mesmo autor:
- a anterior é dele;
- é do mesmo dia;
- não há a etiqueta de outra OS no meio;
- e veio a menos de 5 minutos.

## 4. O ✓✓ (lida)

**O que já funcionava** (provado em PostgreSQL real): abrir a conversa POR PESSOA no escritório marca como lidas as mensagens do técnico, com e sem OS, e não só pela visão da OS. O tempo real do app muda, e o app relê e mostra ✓✓.

**O buraco:**
- A conversa só marcava como lida ao ABRIR.
- Quem já estava com ela aberta e respondia deixava só com ✓ o que o técnico mandou depois. O mesmo acontecia do lado do técnico.

**A correção: responder é ler.**
- Ao escrever na conversa da pessoa, o escritório marca como lidas as mensagens do técnico até ali, só as que ele pode ver ("Ver só os próprios" continua valendo).
- Ao escrever, o técnico marca as do escritório.

## Testes
- `hotfix-chat-ios`:
  - o teclado (área visível, foco, zoom);
  - a tela Chat como camada fixa do tamanho visível, entre o topo e a barra medidos;
  - com o teclado: a barra some, a conversa encolhe, acompanha a rolagem do iPhone, e a barra volta ao fechar;
  - o fim das outras telas acima da barra;
  - a regra do nome, e o "Opa" na tela.
- `hotfix-chat-lida-pg` (PostgreSQL real, rotas reais):
  - o ✓✓ ao abrir a conversa por pessoa, e o tempo real do app que muda;
  - responder é ler, dos dois lados;
  - "Ver só os próprios".
- **Geometria no Chromium:**
  - a área do relógio e a do gesto simuladas (`Emulation.setSafeAreaInsetsOverride`), e o teclado simulado (a área visível encolhe, a janela não, como no iOS);
  - iPhone 390 × 844 (relógio 59, gesto 34) e Android 360 × 780 (barra de gestos 24), com e sem teclado, e a conversa dentro da OS;
  - os números estão no PR;
  - os prints estão em `docs/prints/hotfix-chat-ios/` (`antes-*` × `depois-*`).
