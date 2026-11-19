# Anotações Internas (ferramenta de construção do dono do Frivo)

> **Não é recurso do produto.** É a ferramenta com que o dono do Frivo marca, de qualquer tela, o
> que precisa mudar ali — para virar prompt depois, sem depender da memória. Nenhum cliente do
> Frivo vê o botão, o modo, os pins, a tela ou os dados.

## Como se usa

Um botão discreto no canto inferior esquerdo (ou **Alt+A**) liga o **modo anotação**. No modo, um
véu cobre a tela e o clique marca o ponto: nasce a âncora, o print é tirado e o balão abre para
escrever. Salvou, o pin fica ali. **Esc** fecha o balão; **Alt+A** sai do modo.

Fora do modo não há véu, pin nem elemento por cima: a tela funciona exatamente como antes.

## Quem vê: a trava em três camadas

A chave é o papel `SUPER_ADMIN` (`lib/anotacoes/dono.ts`). Ele **não** pode ser `ADMIN`: no Frivo,
cada empresa-cliente tem o seu próprio ADMIN — gatear por ele entregaria a ferramenta a todo
cliente. `SUPER_ADMIN` já existia no enum do banco e ninguém tinha: nenhum seed cria, nenhuma rota
de criação oferece. Promover é um UPDATE à mão (`prisma/sql/2027-01-25_promover_super_admin.sql`).

| Camada | Onde | O que acontece com quem não é o dono |
| --- | --- | --- |
| Montagem | `app/(dashboard)/layout.tsx` | não recebe **nem a tag** no HTML (e o papel já vem no token: nenhuma consulta nova) |
| Bundle | `components/anotacoes/carregador.tsx` | o chunk da ferramenta nunca é baixado (`dynamic` + `ssr: false`, como o Leaflet do mapa) |
| Servidor | `lib/anotacoes/guarda.ts` → `/api/anotacoes*` e `/anotacoes` | 403 na API, redirecionamento na página — mesmo digitando a URL |

O chunk da **captura de imagem** é mais fundo ainda: só baixa quando o dono salva a primeira
anotação da sessão (`import()` dentro do handler de salvar).

A página `/anotacoes` **não entra no menu** de propósito — nem no lateral, nem nos cartões de
Configurações. Não é recurso do produto e não deve poluir a navegação de ninguém.

## SUPER_ADMIN não é chave-mestra

O papel abre esta ferramenta **e nada mais**. O isolamento multiempresa do Frivo não passa por
papel: ele vem de toda consulta ficar presa ao `empresaId` da **sessão** (`where: { id, empresaId }`,
repetido em cada rota). Um `SUPER_ADMIN` da empresa A continua recebendo "não encontrado" ao pedir
um cliente, uma OS ou um equipamento da empresa B — igual a qualquer outro usuário. As anotações
são por **empresa + usuário**: cada dono vê as suas.

Isso está travado por teste em `tests/unit/anotacoes-pg.test.ts` › *"SUPER_ADMIN não é chave-mestra
entre empresas"*, que tenta alcançar dado de outro tenant pelas rotas reais e exige a recusa.

Dentro da própria empresa o papel também não amplia nada: `pode()` já tratava `ADMIN` e
`SUPER_ADMIN` do mesmo jeito antes desta leva.

## A ancoragem do ponto exato

O ponto é preso ao elemento em **quatro camadas que degradam uma na outra**
(`lib/anotacoes/ancora.ts` e `lib/anotacoes/regras.ts`):

| Camada | O que guarda | Para que serve |
| --- | --- | --- |
| 1. Tela | a rota normalizada (`/ordens/:id?aba=materiais`) | agrupa a lista por **tela**, não por registro |
| 2. Âncora | o marco semântico mais próximo do clique (`data-*` estático ou `id`) + o índice entre os irmãos de mesma chave | reencontra o lugar mesmo com o layout redesenhado |
| 3. Identidade | caminho curto **relativo** à âncora (até 4 níveis) + o texto do elemento + tag/role | desempata dentro da âncora; o texto é o que mais sobrevive |
| 4. Geometria | o clique em **fração** do retângulo da âncora | o pin acompanha o elemento quando ele muda de tamanho |

**O que foi descartado, e por quê:** seletor CSS gerado (as classes são Tailwind e mudam a cada
ajuste), XPath/`nth-child` desde o `body` (uma `div` nova invalida tudo), só o texto (repete demais)
e pixel absoluto (morre com qualquer mudança de layout).

**O que torna isso robusto aqui:** o sistema já tem mais de 2.200 atributos `data-*` estáticos
espalhados, postos pelos testes. Eles descrevem *o que a coisa é*, não *onde está* — por isso
sobrevivem a redesenho.

### O reencontro e as três precisões

| Precisão | Quando | Na tela |
| --- | --- | --- |
| **exata** | achou a âncora e o índice | pin no lugar |
| **aproximada** | achou a âncora (o índice mudou) ou achou pelo texto + papel | pin com o selo "o lugar mudou" |
| **perdida** | não achou nada | **sem pin**; a anotação fica na lista, marcada, abrindo o print |

É isso que faz a anotação nunca virar órfã: **ela muda de estado, não desaparece.**

## O print

`lib/anotacoes/print-cliente.ts`, com `modern-screenshot` (~54 KB, carregado sob demanda).

- Captura **a viewport**, não a página inteira — e isso é possível porque no painel a casca é
  `h-screen overflow-hidden` e quem rola é o `#conteudo-scroll`: a caixa do `body` já é a janela.
- Duas tentativas (escala 0,5 / qualidade 0,7; depois 0,34 / 0,55) até caber em 400 KB.
- Guarda também onde o pin estava **dentro da imagem** (fração), para desenhar o alvo sem
  reprocessar nada.
- **O print nunca bloqueia o salvar**: falhou a captura, estourou o teto ou não passou na validação,
  a anotação é gravada sem imagem e a tela avisa. O print é o contexto; a anotação é o que importa.
- Os elementos da própria ferramenta ficam fora do print (`data-anotacoes-fora-do-print`).

### Privacidade

O print congela a tela **com dado real de cliente dentro**. Ele fica no banco da empresa, só o dono
alcança, e vem por rota própria (`/api/anotacoes/[id]/print`) — a listagem nunca o trafega. **O
exportar em Markdown não leva o print**, de propósito: o texto circula, a imagem não.

## Banco

Duas tabelas, aditivas e idempotentes, que **nascem vazias**
(`prisma/sql/2027-01-25_anotacoes_internas.sql`):

- `anotacoes_internas` — a anotação, as quatro camadas da âncora e o status
  (`aberta` | `feita` | `descartada`, TEXT e não enum: a validação mora em `lib/anotacoes/regras.ts`);
- `anotacao_prints` — o print, 1-1, em tabela **separada** para a listagem nunca arrastar base64.

Como não existe nenhum `SUPER_ADMIN` até a promoção ser rodada, o estado do sistema depois do SQL é
idêntico ao de antes.

## Exportar

Markdown agrupado por tela, com caixa de seleção por status, o rótulo do elemento, a data e a rota —
pronto para colar como prompt (`exportarMarkdown`, puro e testado). Copiar e baixar, na tela.

## O que ficou de fora desta fase (de propósito)

- **Celular**: o botão é `hidden lg:inline-flex`. É ferramenta de construção, usada no desktop.
- **Telas fora do painel**: portal do cliente, link do QR, calculadora e app do técnico têm layout
  próprio e não montam a ferramenta.
- **Gavetas e diálogos**: o pin dentro de uma gaveta só reaparece com a gaveta aberta — e por isso a
  chave da tela inclui `aba` e `secao`, que o sistema já leva na URL.
- **Reancorar com um clique** quando o pin fica aproximado, busca na lista e o relatório de "âncoras
  fracas" (onde falta `data-*`): entram numa fase seguinte, depois do uso de verdade.
