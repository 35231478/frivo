# "Em deslocamento" — o estado visível da atividade

O técnico já tocava **A caminho** e **Cheguei** no app (`docs/tecnico-aviso-cliente.md`,
`docs/tecnico-meu-dia-cheguei.md`), mas o gestor não via isso como estado da atividade: o painel da OS
continuava "Agendada" e o calendário, na barra de agendada. Agora, enquanto o técnico está a caminho,
todo lugar que mostra o estado da atividade diz **Em deslocamento**, num tom próprio do sistema de
design. Ao tocar **Cheguei** (o app inicia a atividade logo em seguida) o estado volta a ser o de
sempre: **Em andamento**.

## 🟢 Sem banco: o estado é DERIVADO do que já é gravado

Levantamento (lido no código, não suposto):

| O quê | Onde | Como |
|---|---|---|
| Os toques "A caminho"/"Cheguei" | tabela `atividade_avisos` (`model AtividadeAviso`) | uma linha por atividade, **evento** (`A_CAMINHO` / `CHEGOU`) e **dia** (dia civil de Brasília), com `registradoEm` (o horário do toque), quem tocou e o que aconteceu com o aviso ao cliente. `@@unique([atividadeId, evento, dia])`. Gravado por `lib/execucao/aviso-cliente.ts` (`avisarCliente`), que **não mexe no status**. |
| O status da atividade | `atividades_os.status` — enum `AGENDADA, EM_ANDAMENTO, CONCLUIDA, CANCELADA` | só vira `EM_ANDAMENTO` por `iniciarAtividade` (`lib/execucao/acoes.ts`) ou pelo seletor do escritório. O app enfileira "iniciar" ao abrir a tela da OS (`components/tecnico/contexto.tsx`), que o "Cheguei" abre — na prática, Cheguei ⇒ Em andamento. |
| O estado do card do app | `lib/tecnico/chegada.ts` (`estadoDoCartao`) | já derivava `a-caminho` / `chegou` dos avisos **de hoje** (`avisoDoDia`) — era o único lugar que "sabia" do deslocamento. |
| Selo do painel da OS | `components/os/os-atividades.tsx` | lia só `a.status` (`STATUS_LABELS`/`TOM_STATUS`). |
| Cor do cartão do calendário | `lib/calendario/cores.ts` + `app/(dashboard)/calendario/page.tsx` | grupo pelo `os.status` (4 cores), atrasada vencendo; o cartão é **um por OS por dia**, pela primeira atividade do dia. |
| Plano de visitas | `lib/os/visitas-server.ts` → `components/os/os-visitas.tsx` | selo pelo `status` da visita. |

Conclusão: o dado existente **permite** derivar. Nenhuma coluna, enum ou SQL novo.

## A regra única: `lib/os/estado-atividade.ts`

```
estadoVisivelDaAtividade({ status, avisosCliente: [{ evento, registradoEm }] }, agora)
```

- status ≠ `AGENDADA` → o próprio status (em andamento, concluída e cancelada nunca mudam);
- `AGENDADA` + **Cheguei hoje** → `AGENDADA` (o deslocamento acabou; o app inicia a atividade em
  seguida e ela vira Em andamento como hoje);
- `AGENDADA` + **A caminho hoje** (sem Cheguei hoje) → **`EM_DESLOCAMENTO`**;
- senão → `AGENDADA`. Um toque de ontem (ou de amanhã) não vale: "hoje" é o **dia civil de Brasília**
  (`chaveDiaBR`), o mesmo critério do aviso ao cliente.

`ROTULO_ESTADO_ATIVIDADE` e `TOM_ESTADO_ATIVIDADE` são o vocabulário e o tom únicos: **Em
deslocamento** / `deslocamento`. Os quatro status gravados mantêm rótulos e tons de sempre.

## O tom no sistema de design

`status.deslocamento` em `lib/ui/tokens.ts`: **índigo** `#4338CA` (barra, ícone), claro `#EEF0FB`
(fundo da pílula), texto `#3730A3` — 7,6:1 sobre o claro e 7,0:1 do branco sobre o DEFAULT, acima
do mínimo de 4,5:1 (o teste de contraste do design system cobre todos os `status`). Classes:
`bg-deslocamento`, `bg-deslocamento-claro text-deslocamento-texto`, `.pill-deslocamento`;
`StatusPill tom="deslocamento"`. Por que um matiz novo: o estado fica **entre** agendada (petróleo)
e em andamento (âmbar) e não pode se confundir com nenhum dos dois nem com OK/atrasado/previsto.

## Onde aparece

| Tela | Como |
|---|---|
| **Painel de Atividades da OS** (`os-atividades.tsx`) | O selo mostra o estado visível (`data-selo-atividade="EM_DESLOCAMENTO"`, tom `deslocamento`); a linha ganha `data-estado-atividade` e mantém `data-status-atividade` (o gravado). A página da OS carrega os avisos **de hoje** de cada atividade (`avisosCliente: { where: { dia: hoje } }`). O seletor de status do escritório continua com os quatro status gravados — deslocamento não é opção. |
| **Calendário** (`cores.ts`, `calendario-grid.tsx`, `calendario/page.tsx`) | Quinto grupo `deslocamento` (barra índigo, hora em texto normal), entre agendada e em andamento na legenda e na ordem dos pontos do celular. `grupoDoCard`: **atrasada > deslocamento > status da OS**. `card.deslocamento` vale quando **alguma** atividade da OS naquele dia está em deslocamento (o cartão é um por OS por dia). O cartão grande (passar o mouse) ganha a pílula "Em deslocamento" ao lado do status da OS. |
| **Plano de visitas** (`visitas-server.ts`, `os-visitas.tsx`) | `VisitaTela.estado` (uma consulta a mais, `avisosDeHojePorAtividade`); o selo lê `estado ?? status`. |
| **App do técnico** (`meu-dia.tsx`) | O chip do card que dizia "A caminho" agora diz **Em deslocamento**, no mesmo tom. O **botão** continua "Avisar que estou a caminho" / "A caminho" e o registro "A caminho · avisado às 13:40" também: o nome do toque é um, o nome do estado é outro. |

Fora do escopo, de propósito: a **lista de OS** e o **estágio da OS** (são status da OS, não da
atividade); o **relatório** da OS (histórico — um estado transitório não tem lugar lá); o **mapa**
(`cartao-posicao.tsx` mostra "Executando"/"No local" a partir da posição, outra fonte). Se o dono
quiser "Em deslocamento" no mapa, é uma leva à parte.

## Pausada / Impedida — só avaliação, nada implementado

- **No nível da OS** já existe base: `PAUSADA` e `AGUARDANDO_PECA` são status gravados
  (`StatusOsGravado`), com badge e estágio "Em execução"; o calendário os agrupa em "andamento".
- **No nível da atividade** não há nada: o enum tem só os quatro valores; não há motivo, horário de
  pausa nem quem pausou. Um "Impedida" (cliente ausente, sem acesso, sem energia) também não existe
  em lugar nenhum.
- **Prazos**: `lib/prazos/cumprimento.ts` tem a noção de pausa do prazo de atendimento por causa do
  cliente (`ehPausa`/`linhaPausada`) — é a base conceitual mais próxima de "impedida", mas é do prazo,
  não da atividade.
- Para derivar como o deslocamento **não dá**: nada hoje registra "parei"/"impedido" na atividade. O
  mínimo, se o dono quiser, seria 🔵 um registro novo (tabela de eventos da atividade, aditivo) ou
  dois eventos a mais em `atividade_avisos` com motivo — decisão de produto a tomar antes.

## Decisões que o dono pode querer rever

1. **"Cheguei" sem o app ter iniciado** mostra "Agendada" (o status gravado), não "No local": o pedido
   diz "ao marcar Cheguei/iniciar vira Em andamento como hoje" — e o app inicia logo ao abrir a OS. Se
   preferir um estado "No local" também para o gestor, é uma linha na regra e um tom a mais.
2. **Cartão do calendário é por OS e dia**: com duas atividades da mesma OS no dia, a barra fica
   índigo se qualquer uma estiver a caminho (o cartão mostra a hora da primeira).
3. **O toque vale só no dia** (Brasília), como o aviso ao cliente. Um "A caminho" às 23:50 não vira
   "Em deslocamento" no dia seguinte.
