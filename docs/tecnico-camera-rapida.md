# App do técnico — Câmera rápida (fase 1: núcleo, offline, sem IA)

O técnico tira fotos à vontade, sem escrever nada. O app organiza: cada foto vai para o equipamento
certo pela **etiqueta QR fotografada**. O que não tem etiqueta legível **não é chutado** — fica "a
identificar" e o técnico resolve em um toque.

🟢 **Não precisou de banco.** Ver "Por que sem banco" abaixo — é a principal decisão para conferir.

## Fluxo

1. **Atalho grande "Câmera rápida"** na OS (acima dos equipamentos) e **"Câmera"** em cada OS aberta do
   Meu dia. Abre direto na câmera.
2. **Rajada:** tocou, fotografou. As miniaturas empilham. Não há diálogo, legenda nem seleção no meio.
3. **Antes / Depois:** um toque na câmera (padrão: antes). Vale para as fotos seguintes.
4. **"Pronto":** abre a conferência.
   - Grupo com a etiqueta de **um** equipamento conhecido → gravado sozinho, aparece com ✓ e o nome.
   - Grupo sem etiqueta legível → **A identificar**: escolher o equipamento, etiquetar um novo,
     marcar como geral da OS ou descartar.
5. **"TUDO OK"** em cada equipamento organizado fecha o checklist num toque. A exceção se escreve na
   tela do equipamento ("Abrir"), pelo fluxo de Atenção que já existe.

## Critério de agrupamento por tempo

- Fotos em ordem de disparo. Começa um grupo novo quando passam **mais de 30 segundos** desde a foto
  anterior (`INTERVALO_GRUPO_MS`).
- O intervalo conta da **última** foto: uma rajada longa não se parte.
- **Por que 30 s:** fotos do mesmo equipamento saem com poucos segundos entre si; ir até outra máquina
  e enquadrar costuma passar disso. É conservador de propósito — uma pausa longa na mesma máquina só
  cria um grupo a mais para confirmar. O erro que importa evitar é o contrário: juntar duas máquinas.
- **Máquinas lado a lado**, fotografadas sem pausa: o botão **"Próximo equipamento"** corta o grupo na
  hora, sem depender do relógio.
- Na conferência, **"Separar"** corta um grupo na foto escolhida (para quando duas máquinas entraram
  juntas).

## Identidade: só pelo QR da foto — nunca por adivinhação

O QR é lido **da própria foto parada**, no aparelho, com o jsQR (o mesmo motor do leitor de QR; funciona
no iPhone e sem sinal). A regra, determinística:

| O que as fotos do grupo mostram | Resultado |
|---|---|
| A etiqueta de **um** equipamento da unidade | **Identificado.** O grupo inteiro vai para ele. |
| Nenhuma etiqueta legível | **A identificar** — não herda o equipamento do grupo vizinho. |
| **Duas** etiquetas diferentes | **A identificar** — o app não escolhe uma; pede para separar. |
| Etiqueta do sistema que ainda não é de um equipamento daqui (avulsa) | **A identificar** — "Etiquetar novo" já abre com ela. |
| QR que não é etiqueta do sistema (placa do fabricante, link qualquer) | Ignorado: não identifica nem atrapalha. |

"Equipamento da unidade" = a mesma lista que o leitor de QR da OS usa (os equipamentos da unidade da
OS que o aparelho guarda). Etiqueta de outra unidade conta como desconhecida.

## Levantamento: o que foi reaproveitado × o que foi criado

| Peça | Situação | Como entrou |
|---|---|---|
| **Pipeline de fotos** (redução a 1280 px + marca d'água conforme as permissões) | Reaproveitado | Extraí o caminho do `BotaoFoto` para `processarFoto` e as duas câmeras passam por ele. Nenhuma foto entra por fora. |
| **"Foto somente pela câmera"** | Reaproveitado | A câmera rápida é ao vivo — só fotografa na hora. Na saída pela câmera do sistema é o `BotaoFoto` de sempre, com `capture` e a recusa de arquivo antigo. |
| **Fotos antes/depois do equipamento** (operação `foto`, com `momento`) | Reaproveitada | Cada foto identificada vira uma `foto` normal: aparece em "Fotos ANTES/DEPOIS do serviço", no relatório e no PDF, sem código novo. |
| **"Fotos do serviço"** (operação `fotoOs`) | Reaproveitada | Para o grupo marcado como "Geral da OS", com legenda automática. |
| **Vínculo de equipamento na OS** (operação `vincular`) | Reaproveitado | Equipamento identificado que ainda não está na OS é vinculado antes das fotos. |
| **Cadastro de equipamento em campo** (gera/usa o QR) | Reaproveitado | "Etiquetar novo" abre o mesmo formulário, já com a etiqueta fotografada; as fotos do grupo vão para o equipamento novo. |
| **"Tudo OK num toque"** (operação `tudoOk`) | Reaproveitado | O mesmo botão, na conferência, por equipamento. |
| **Fluxo de Atenção** (foto + observação) | Reaproveitado | Sem mudança: "Abrir" leva à tela do equipamento. |
| **Fila de sincronização offline** | Reaproveitada | Nenhuma operação nova: o servidor não mudou. |
| **Leitura de QR por canvas** (jsQR, `lib/qr/leitor.ts`) | Reaproveitada | Ganhou a leitura de um quadro parado (`lerQrDoCanvas`) e o pedido de câmera em resolução de foto. |
| **Resolver QR → equipamento** (`equipamentoDoQr`) | Reaproveitado | A mesma regra do leitor de QR da OS. |
| **Banco do aparelho** (IndexedDB) | Reaproveitado | A guarda usa a loja `dados` que já existia (só ganhou "apagar"). Sem mudança de versão. |
| Regras (`lib/tecnico/camera-rapida.ts`) | **Criado** | Grupos, identidade, legenda, e a tradução do grupo nas operações existentes. Puro. |
| Guarda no aparelho (`lib/tecnico/offline/rapida.ts`) | **Criado** | As fotos ainda sem equipamento, gravadas no disparo. |
| Câmera em rajada (`components/tecnico/camera-rapida.tsx`) | **Criado** | Câmera ao vivo dentro da página. |
| Conferência (`components/tecnico/conferencia-rapida.tsx`) | **Criado** | Os grupos e as saídas. |

**Por que uma câmera nova:** a "câmera" que o app tinha é o campo de arquivo do sistema — abre o app de
câmera do celular, uma foto por vez, com confirmação. Rajada sem diálogo só é possível com a câmera ao
vivo dentro da página. Ela não é paralela às permissões: usa o mesmo `processarFoto`.

## Por que sem banco — decisão minha, confira

Você previu banco para os grupos e o estado "a identificar". Fiz **sem**:

- As fotos ainda sem equipamento ficam **guardadas no aparelho** (IndexedDB, gravadas no disparo).
- Quando ganham equipamento — pelo QR ou pelo técnico — viram as gravações que já existem (`vincular`,
  `foto`, `fotoOs`) e seguem pela fila de sempre. O servidor não precisa saber de "grupo".

O que isso compra: nenhum SQL para aplicar, nenhum risco de ordem de deploy, e todo o resto (relatório,
PDF, tela do equipamento) funciona sem tocar.

O que isso custa: **enquanto está "a identificar", a foto só existe no celular do técnico** — o
escritório não a vê, e ela não está no servidor. Para isso não virar foto perdida:

- a OS mostra o aviso "N fotos a identificar — toque para conferir";
- **"Concluir atividade" não conclui** enquanto houver foto a identificar: leva à conferência;
- o app já pede ao navegador armazenamento persistente (o que estava lá para a fila).

Se você quiser que o escritório veja (ou resolva) os grupos pendentes, aí sim é banco: uma tabela de
fotos em espera + duas operações novas. É uma fase 2 natural; a fase 1 não depende dela.

## Comportamento offline

- **Captura, QR, agrupamento e conferência acontecem no aparelho**, sem nenhuma chamada de rede.
- **Cada foto é gravada no disparo** (a imagem primeiro, depois o índice). Fechar o app, reiniciar o
  celular ou ficar sem sinal no meio não perde nada — nem precisa ter tocado em "Pronto".
- **Reabrindo sem sinal:** a OS mostra as fotos a identificar; a conferência abre com os grupos, as
  imagens e o antes/depois. Dá para resolver ali mesmo: as gravações entram na fila.
- **Quando o sinal volta**, a fila sobe sozinha. Cada foto leva o id gerado no aparelho: reenviar não
  duplica.
- A OS precisa já estar no aparelho (aberta uma vez com sinal, ou baixada pelo Meu dia) — é a regra do
  app inteiro.

## Permissões do app

- **Marca d'água:** ligada, toda foto é carimbada (data/hora; OS, endereço e coordenadas conforme a
  empresa ligou). Desligada, nenhuma.
- **Foto somente pela câmera:** respeitada nos dois caminhos (ver o levantamento).
- **Exibir dados do cliente desligado:** nem a câmera nem a conferência mostram nome ou endereço.
- **Permitir cadastrar equipamento em campo desligado:** sem "Etiquetar novo"; as outras saídas ficam.

## Outras decisões — confira

1. **Grupo identificado grava sem confirmação** ao tocar "Pronto". A identidade vem de uma etiqueta
   fotografada no próprio grupo. Para desfazer, apaga-se a foto na tela do equipamento (como qualquer
   foto). Não há "desfazer o grupo" nesta fase.
2. **Equipamento da etiqueta que não está na OS é vinculado sozinho** — é o que o leitor de QR já faz.
3. **"Geral da OS"** não estava no pedido: acrescentei para a foto que não é de equipamento nenhum não
   ser forçada num equipamento nem descartada.
4. **Legenda automática:** na foto de equipamento, a "legenda" é a própria classificação (equipamento +
   antes/depois), que é o que as telas e o relatório mostram. Texto só existe na foto geral
   ("Câmera rápida — antes"), porque lá a legenda é obrigatória.
5. **Fotos a identificar bloqueiam concluir.** Dá para descartar, mas é uma decisão do técnico,
   confirmada.

## Limites desta fase

- **A foto é um quadro do vídeo da câmera** (pedido em 1920×1080, reduzido a 1280 como as outras fotos
  do app). Não há flash, zoom nem foco por toque. Em pouca luz pode sair menos nítida que a câmera do
  sistema — que continua disponível nos botões de foto do equipamento.
- **Sem WebKit neste ambiente:** não testei no Safari real. A câmera segue o mesmo caminho do leitor de
  QR já em produção (vídeo com `playsinline`, mudo). Vale conferir num iPhone.
- **A câmera simulada dos testes tem 640×480**; a resolução real e a nitidez só o aparelho mostra.
- **O QR precisa aparecer legível em pelo menos uma foto do grupo.** Etiqueta longe, torta ou com
  reflexo = grupo "a identificar" (o caminho seguro).

## Junto

- Duas gravações seguidas antes de a tela redesenhar marcavam o "início do atendimento" duas vezes na
  fila (inofensivo, o servidor ignorava a segunda). Agora marca uma.
- O texto da câmera bloqueada ganhou uma versão só com a causa, para a câmera rápida não repetir a
  frase do leitor de QR.

## Testes

- `camera-rapida` (24): grupos por tempo e por corte; identidade (uma etiqueta, nenhuma, duas, avulsa,
  QR do fabricante); o grupo nas operações existentes, validadas pelo esquema da fila; separar, tirar
  e gravar; a guarda fechando e reabrindo o banco, com disparos simultâneos.
- `camera-rapida-ui` (28, tela real com o banco do aparelho, o motor de sincronização e QR de verdade
  nas fotos): atalhos, rajada sem diálogo, antes/depois, identificação pela etiqueta, a identificar
  (escolher, geral, descartar, separar, etiquetar novo), TUDO OK, offline (fila e fechar/reabrir),
  trava ao concluir, permissões, câmera bloqueada.
- `app-tecnico-ui`: duas expectativas atualizadas **de propósito** — o cartão do Meu dia agora tem a
  barra com o atalho "Câmera" mesmo sem Rota e Ligar (que continuam escondidos como antes).
- Mutação: 12 regras quebradas de propósito, todas pegas (uma exigiu um teste a mais).

## Conferido no navegador (Chromium, app real, câmera simulada com um QR)

- Atalho do Meu dia → OS já na câmera.
- Rajada: 3 fotos em ~1,1 s; 5 fotos, todas com o QR lido; nenhum campo na tela da câmera.
- Conferência: "Split Sala 12 · 5 fotos · 3 antes · 2 depois · pela etiqueta QR"; no banco, 5 fotos
  nesse equipamento com o antes/depois certo. TUDO OK → "Checklist OK" (3 respostas no banco).
- Sem etiqueta: 2 grupos a identificar, nada no banco; escolhido o equipamento, 2 fotos nele.
- Concluir com fotos a identificar: abre a conferência, não o concluir.
- Sem sinal: organizado no aparelho, nada no banco; sinal de volta, 3 fotos no banco.
- Etiqueta avulsa → "Etiquetar novo": equipamento criado com a etiqueta, 2 fotos nele.
- Câmera bloqueada → foto pela câmera do sistema, identificada pela etiqueta.

## Prints

`docs/prints/tecnico-camera-rapida/` (desktop e celular, 01 a 13). O visor mostra o vídeo de teste do
navegador (um QR, ou o padrão verde).
