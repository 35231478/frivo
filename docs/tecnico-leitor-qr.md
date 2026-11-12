# Leitor de QR Code — funciona em todos os navegadores, inclusive iPhone

🟢 **Sem mudança de banco.**

## O bug

No iPhone (Safari **e** Chrome do iOS, que usa o mesmo motor — WebKit), tocar em "Ler QR Code" mostrava
"Seu navegador não suporta leitura de QR pela câmera" e a câmera nem abria.

## Levantamento: como a leitura estava implementada

Um componente só, `components/os/scanner-qr.tsx`, usado em **três** lugares:

| Onde | Para quê |
|---|---|
| App do técnico › OS › **Ler QR Code** (`components/tecnico/execucao.tsx`) | Vincular/atender o equipamento da OS pelo QR |
| App do técnico › **Cadastrar novo equipamento** › QR Code (`components/tecnico/cadastro-equipamento.tsx`) | Ler a etiqueta avulsa que vai no equipamento novo |
| Painel › OS › execução da atividade (`components/os/atividade-execucao.tsx`) | O mesmo vínculo por QR, pelo escritório |

**O que era usado:** só o `BarcodeDetector` nativo do navegador. A regra era
`"BarcodeDetector" in window` — se não existisse, o componente desistia: mostrava a frase acima e sobrava
só o campo de digitar. Causa confirmada: o WebKit do iOS não tem `BarcodeDetector`.

Dois problemas a mais que apareceram no levantamento:

- Em navegadores que **têm a classe mas não leem QR** (acontece em alguns desktops), a câmera abria e
  ficava olhando para sempre, sem ler e sem avisar.
- A câmera **reiniciava a cada redesenho** da tela de trás: o efeito dependia da função `onLer`, e o
  painel passava uma função nova a cada render.

## O que passou a ser usado

| | Antes | Agora |
|---|---|---|
| Motor de leitura | `BarcodeDetector` (só) | `BarcodeDetector` **quando existe e lê QR**; senão — iPhone incluso — a biblioteca **jsQR**, que lê o QR dos pixels de um canvas |
| Detector nativo que falha no meio | Ficava sem ler | Depois de 3 falhas seguidas, passa para o jsQR |
| Sem câmera / permissão negada | "Use a entrada manual" | Explica o motivo e oferece **foto do QR**, **tentar a câmera de novo** e **digitar** |
| Foto do QR | Não existia | Abre a câmera do sistema; a foto é lida **no aparelho** |
| Rede | — | Nenhuma: tudo local, lê **sem sinal** |

**Biblioteca:** `jsqr` 1.4.0 (Apache-2.0, sem dependências). Entra no pacote do próprio app — não é
script de fora —, então funciona offline. Custo medido: ~130 KB minificado, **~46 KB comprimido** a mais
nas telas que têm o leitor.

Por que jsQR e não html5-qrcode ou zxing-js: é a menor, lê só QR (é o que o sistema usa) e não traz
interface própria — o leitor continua com a cara do app. Mantive o nativo como primeira opção onde ele
existe porque usa o leitor do próprio aparelho (mais rápido em etiqueta gasta ou pouca luz).

### Câmera

- `getUserMedia` pedindo a câmera **traseira** como preferência, sem áudio. Se o aparelho não tiver
  "traseira" (notebook), aceita qualquer câmera.
- O vídeo vai com `playsinline` e mudo — exigência do iOS para tocar dentro da página.
- Um quadro lido a cada ~140 ms; do vídeo, só o quadrado central (o que o visor mostra), reduzido a 480 px.
- Fechar o leitor ou ler um QR desliga a câmera. A leitura é entregue **uma vez só**.

### Quando a câmera não abre

| Situação | Mensagem |
|---|---|
| Permissão negada | "Câmera bloqueada neste navegador. Libere o acesso, tire uma foto do QR ou digite o código." |
| Aparelho sem câmera | "Nenhuma câmera encontrada. Tire uma foto do QR ou digite o código." |
| Câmera em uso por outro app | "A câmera está em uso por outro app. Tire uma foto do QR ou digite o código." |
| Navegador sem a API de câmera | "Este navegador não abre a câmera aqui. Tire uma foto do QR ou digite o código." |
| Qualquer outro erro | "Não foi possível abrir a câmera. Tire uma foto do QR ou digite o código." |

Em todas, ficam na tela: **Tirar foto do QR**, **Tentar a câmera de novo** e o campo de **digitar**.
"Tirar foto do QR" e o campo de digitar aparecem também com a câmera funcionando (etiqueta difícil de focar).

- A foto abre a **câmera do sistema** (`capture`), que não depende da permissão de câmera do navegador.
  Vale para qualquer configuração de "Foto somente pela câmera".
- Foto sem QR: "Não achei um QR nessa foto. Enquadre o código inteiro, de perto, e tente de novo." — e
  o leitor continua aberto.
- Alvos de toque: fechar, foto, tentar de novo, campo e confirmar com 44 px ou mais.

## O que foi verificado e como

**Testes automatizados (39):**

- `qr-leitor` (19): o jsQR decodificando **QR codes de verdade**, gerados com a mesma biblioteca que
  imprime as etiquetas (link público, códigos, QR pequeno no quadro, foto retangular, invertido);
  detector nativo ausente / sem o formato / quebrado; recortes; pedido da câmera; as mensagens (todas
  apontam foto e código, nenhuma diz "não suporta"); nada de rede no código.
- `scanner-qr-ui` (20): o componente como iPhone (sem `BarcodeDetector`), como Android (com), com
  detector que não lê QR, com detector que falha no meio, câmera bloqueada / inexistente / sem API,
  tentar de novo, foto boa / sem QR / inválida, digitar, sem sinal, câmera que não reinicia.

**Navegador de verdade (Chromium, app real, câmera simulada com um vídeo contendo um QR):**

- Sem `BarcodeDetector` (a condição do iPhone): a câmera abre, o leitor usa o jsQR e lê em 0,3–0,4 s;
  o equipamento da OS é identificado e marcado como atendido.
- Sem sinal: lê igual; a gravação fica na fila do aparelho.
- Câmera indisponível: foto do QR lida no aparelho; código digitado também.
- Cadastro em campo: a etiqueta avulsa é lida ("Etiqueta QR lida.").

**O que NÃO foi possível verificar aqui — confira num iPhone de verdade:**

- **Não há WebKit neste ambiente.** O caso do iPhone foi reproduzido removendo o `BarcodeDetector` do
  Chromium (que é exatamente a diferença que causava o bug), mas não rodei no Safari real. O que
  depende do WebKit em si — o pedido de permissão, o vídeo dentro da página, o PWA instalado na tela
  inicial — está feito como o iOS exige, mas só o aparelho confirma.
- **O caminho do detector nativo** (Android) está coberto por testes com dublê: o Chromium deste
  ambiente não tem `BarcodeDetector`, então no navegador real quem leu foi sempre o jsQR.
- **Permissão negada de verdade:** o Chromium sem tela não mostra o pedido de câmera; o print dessa
  tela foi feito simulando o erro que o navegador devolve (`NotAllowedError`).

## Arquivos

- `lib/qr/leitor.ts` (novo) — os motores, a foto, a câmera, as mensagens
- `components/os/scanner-qr.tsx` — o leitor reescrito (mesmo nome, mesmos parâmetros: os três lugares não mudaram)
- `package.json` / `package-lock.json` — `jsqr` 1.4.0

## Prints

`docs/prints/tecnico-leitor-qr/` (desktop e celular): câmera aberta sem `BarcodeDetector`, QR lido,
sem sinal, câmera bloqueada com as saídas, e a etiqueta lida no cadastro em campo. O visor verde é o
vídeo de teste do navegador.
