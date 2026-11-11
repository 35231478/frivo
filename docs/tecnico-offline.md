# App do técnico — offline-first (Etapa 2d): como funciona e o que foi endurecido

**Sem mudança de banco.**

## Como o app se comporta (o contrato)

| Situação | O que acontece |
|---|---|
| Técnico grava (resposta, medição, foto, áudio, adicional, concluir) | Vira uma **operação na fila do aparelho** na hora; a tela já mostra. Só depois tenta subir. |
| Sem sinal | Nada é enviado; o indicador diz **Offline · N** (N = gravações no aparelho). A OS mostra "N gravações desta OS no aparelho". |
| O sinal volta | A fila sobe **sozinha**, em ordem: no evento de rede do navegador, ao voltar para o app, e a cada 30 s enquanto houver fila. |
| Fechar e reabrir o app sem sinal | Tudo continua lá — respostas e **fotos inteiras** ficam no IndexedDB do aparelho, um banco por usuário. |
| Fotos | Comprimidas no aparelho (~200–400 KB), guardadas na fila e enviadas depois; aparecem com a etiqueta "no aparelho". |
| Servidor confirmou | A operação só sai da fila quando chega um **retrato novo** da atividade que já a contém. |
| Resposta perdida (rede caiu no meio) | Reenvia com o **mesmo id**; o servidor não aplica duas vezes. |
| Conflito (o escritório mexeu no mesmo item) | O retrato novo **não passa por cima** do que está na fila; ao subir, vale a gravação do técnico, item a item. |
| Servidor recusou (ex.: atividade concluída pelo escritório) | A gravação **fica guardada com o motivo**; as seguintes da mesma OS esperam. Só sai se o técnico descartar. Reaberta a atividade, "Sincronizar agora" sobe tudo. |
| Sessão expirou | "Entre de novo — nada foi perdido": a fila espera o login. |

### Indicador (sempre no topo)
`Offline` / `Offline · N` · `Sincronizando…` · `N a enviar` · `Sincronizado` · `N recusada(s)` · `Entre de novo`.
Tocar leva ao Perfil, que explica o estado, mostra a fila e as recusadas com o motivo.

## Levantamento — o que já existia

Tudo da tabela acima já funcionava (motor em `lib/tecnico/offline/motor.ts`, banco em `banco.ts`,
estado da tela = retrato + fila em `estado.ts`), com testes em `app-tecnico-offline` e `app-tecnico-pg`.

## O que foi endurecido

1. **Prazo em toda requisição** (90 s para enviar um lote, 30 s para ler). Antes, uma requisição
   pendurada em rede ruim deixava o app em "Sincronizando…" indefinidamente, sem tentar de novo.
   Agora vira falha de rede: a fila fica no aparelho e tenta de novo com espera crescente.
2. **Depois de uma falha de rede, sobe uma gravação por vez.** Em rede instável cada confirmação já
   fica garantida antes da próxima; quando um envio dá certo, volta aos lotes.
3. **Sem sinal o indicador fica em "Offline".** Antes piscava "Sincronizando…" a cada toque.
4. **Armazenamento protegido.** O app pede ao navegador para não limpar o que está guardado quando
   faltar espaço. Se o navegador negar e houver fila, o Perfil sugere instalar o app na tela inicial.
5. **Aviso se o aparelho não guardar** (sem espaço, armazenamento bloqueado). Antes a falha era
   silenciosa; agora o técnico é avisado na hora e a tela não finge que gravou.

## Limites conhecidos (para decisão)

- **Proteção do armazenamento é um pedido.** O navegador pode negar (em geral concede a app
  instalado). Sem ela, o risco de limpeza existe só com o aparelho quase sem espaço.
- **Prazo de 90 s por lote** foi escolhido para não cortar um envio lento que ainda progride; com
  uma gravação por vez depois da falha, uma foto (~300 KB) cabe folgado mesmo em rede fraca. Se o
  campo mostrar rede pior que isso, o número é uma constante (`PRAZO_ENVIO_MS`).
- **Trocar de aparelho com fila pendente** (ou "apenas um dispositivo ativo" derrubar a sessão): a
  fila fica no aparelho antigo e sobe quando ele entrar de novo nele.

## Testes

`tecnico-offline-endurecido` (16 casos): indicador por estado e na sequência real; fila sobe sozinha
(evento de rede e volta ao app); fechar/reabrir sem sinal com fotos; outro técnico no mesmo aparelho;
conflito com o escritório; recusa guardada; prazo de envio e de leitura; uma por vez após falha;
armazenamento protegido; aviso sem espaço; dica no Perfil.

## Prints

`docs/prints/tecnico-offline/` — celular (01 a 07) e desktop (08, 09).
