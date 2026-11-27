# App: assinatura do aceite

No #269 (item J), a assinatura deixou de se apagar ao redimensionar a tela nos links do orçamento, do
relatório e da medição (escritório e cliente). O **aceite da OS** ficou de fora daquela leva. É o quadro do
app do técnico e do "Colher assinatura" do escritório (`components/os/aceite-assinatura.tsx`).

## Levantamento

- **Onde o app captura assinatura:** só no aceite da OS (`AceiteNaOs` → `AssinaturaDoCliente`). O relatório da
  atividade, o checklist e o EPI não têm quadro de assinatura no app: o relatório mostra a do aceite.
- **Antes:** o quadro usava o padrão da biblioteca (`clearOnResize`), que **limpa** o desenho a cada `resize`
  da janela. Girar o celular apagava a assinatura (prints `antes-50…52`). No celular, abrir o teclado também
  dispara `resize`.
- **A correção do #269** guardava os traços e redesenhava nas **mesmas coordenadas**. Ao girar para retrato, o
  que passava da largura nova ficava cortado. Além disso, ela lia os traços no formato novo do signature_pad
  (`{ points }`), mas o instalado é o 2.3, que guarda cada traço como uma **lista de pontos**.

## O que mudou

- **O quadro não se limpa sozinho** (`clearOnResize={false}` + `useAssinaturaPreservada`), no app e no escritório.
- **Só redesenha quando o quadro muda de tamanho de verdade.** Rolar a tela ou abrir o teclado não mudam o
  quadro, então nada é refeito.
- **Quando muda (girou, a janela encolheu):** guarda os pontos e redesenha **sem distorcer**, com a mesma
  escala nos dois eixos.
  - Se a assinatura cabe no quadro novo, o tamanho fica igual. Girar e voltar devolve a assinatura
    exatamente como estava.
  - Se não cabe, ela encolhe só o necessário para caber inteira, com margem.
  - O centro fica na mesma posição relativa do quadro (o que estava no meio continua no meio).
- **Também observa o próprio quadro** (`ResizeObserver` e `orientationchange`), além do `resize` da janela.
- **Os dois formatos de traço** são aceitos (lista de pontos e `{ points }`). Com isso, a correção passa a
  valer também nos quadros do #269.
- **"Limpar" continua limpando.** Assinatura vazia (ou limpa e girada) não envia: aparece "Peça para o cliente assinar no quadro."
- **Dois toques rápidos em "Confirmar" geram um aceite só.** Sem sinal, o aceite entra uma vez na fila do
  aparelho, e o servidor já era idempotente (`os-aceite-pg`).
- **A imagem salva é só a assinatura:** recortada com 12 px de margem, em escala fixa (2×). Sai igual em
  qualquer aparelho e orientação, e é a mesma no aceite, no relatório e no PDF, sempre sem distorcer
  (`object-contain` na tela, proporção preservada no PDF).
  - No PDF, o bloco de assinaturas reserva a altura dela, para não encostar na linha de cima.

## Mudanças fora do app do técnico

| Arquivo | O que muda |
|---|---|
| `lib/assinatura-quadro.ts` | Redesenho em escala, os dois formatos de traço, observação do quadro e recorte da imagem. Vale para os quadros do #269 (orçamento, relatório e medição) |
| `components/os/aceite-assinatura.tsx` | O quadro do aceite é o mesmo no app e no escritório ("Colher assinatura") |
| `lib/relatorio-atividade-pdf.ts` | Altura reservada para a assinatura recortada (até 42 pt) |

## Testes

- `app-assinatura-aceite` (12, regra): mesmo tamanho não mexe; girar e voltar devolve igual; cabe mantém o
  tamanho; não cabe encolhe na mesma escala e fica dentro do quadro; canto; formato novo; quadro escondido;
  quando refazer; recorte com margem; o mesmo recorte em retrato e paisagem; proporção no PDF; `object-contain`
  na tela.
- `app-assinatura-aceite-ui` (10, tela): girar com traço redesenha em escala; voltar devolve igual;
  `orientationchange`; teclado/rolar não refaz; vazio e girado continua vazio; vazia não envia; Limpar e girar
  não envia; confirmar depois de girar manda o recorte; dois toques mandam um aceite só.
- **2 testes antigos atualizados:** o quadro falso de `os-aceite-ui` e `os-aceite-avaliacao-ui` ganhou
  `toData` (sem pontos, a imagem é o quadro inteiro, como antes).

## Prints (fictícios)

`docs/prints/tecnico-assinatura/`, no iPhone 13 e no Pixel 7:

- `antes-50…52`: assina em retrato, gira para paisagem (a assinatura some) e volta;
- `depois-50…55`: assina, gira (continua inteira e centralizada), volta (igual), teclado aberto, confirmado e o
  relatório público com a assinatura;
- `depois-56`: a página do PDF com a assinatura.
