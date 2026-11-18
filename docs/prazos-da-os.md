# Prazos da OS — dois conceitos que não se confundem

A OS tem **dois prazos diferentes**, com donos diferentes, e uma **data de agenda** que não é prazo.
Este documento é a referência: o que é cada um, onde mora no código e quem lê.

| | O que é | De quem é a promessa | Conta a partir de | Onde mora |
|---|---|---|---|---|
| **Data prevista** | Quando o serviço está **marcado** (agenda) | — (não é prazo) | — | `ordens_servico.previsao_conclusao` |
| **Prazo de execução** | Até que **dia** a OS precisa estar concluída. É o "Prazo para finalizar" da tela | Da empresa com o técnico (interno) | O dia do prazo, em Brasília | `ordens_servico.prazo_execucao` · `lib/os/prazo-execucao.ts` |
| **Prazo de atendimento** | O que o **contrato** promete ao cliente: "comparecer em 4 h", "resolver em 24 h" | Da empresa com o cliente | A **abertura do chamado** pelo cliente | `contrato_prazos_atendimento` + colunas `atendimento_*` da OS · `lib/atendimento/prazo.ts` |

As etapas com prazo (compra de peça, etc. — os antigos "Modelos de prazo") continuam existindo e são
outra coisa: prazos **internos de uma etapa**, não da OS inteira.

## 1. Prazo de execução

### A regra do prazo que vale

> **Prazo efetivo = o prazo próprio da OS; sem ele, o dia da data prevista.**

Quem marcou o serviço para o dia 20 e não disse outra coisa espera vê-lo pronto no dia 20. É o que o
sistema sempre fez — por isso **nenhuma OS antiga muda** de "no prazo" para "atrasada" (nem o
contrário) e **o SQL não preenche nada retroativamente**.

`prazoEfetivo(os)` é o único lugar que conhece essa regra.

### A regra de "atrasada" (uma só)

> **Atrasada = OS ainda aberta (nem concluída, nem cancelada) cujo dia do prazo efetivo já passou em
> Brasília.** No dia do prazo ela "vence hoje"; só no dia seguinte atrasa.

| Forma | Função | Quem usa |
|---|---|---|
| OS a OS | `osAtrasada(os, agora)` / `situacaoPrazoExecucao(os, agora)` | Calendário, central da OS (cabeçalho, Resumo, "O que falta") |
| Filtro do banco | `whereOsAtrasada(agora)` | Dashboard ("Atrasadas"), sino, assistente |
| Dia a dia | `diaCivilPassou(prazoEfetivo(os))` | Relatório de contratos |

Um teste (`tests/unit/prazos-motor.test.ts`) varre `app/`, `lib/` e `components/` e falha se algum
arquivo voltar a comparar a data prevista com hoje por conta própria. A única exceção é o Portal do
cliente, que diz "a visita era dia X — a reagendar": isso é agenda, não prazo.

> Antes, o Dashboard comparava a data prevista **por instante** (uma OS marcada para hoje às 8h já
> contava como atrasada às 9h) e o Calendário, por dia. Agora os três números batem.

### O campo que tinha cinco papéis

`previsao_conclusao` fazia cinco coisas. Ficou com uma (a agenda); o prazo ganhou coluna própria.

| Uso antigo de `previsao_conclusao` | Agora |
|---|---|
| "Prazo para finalizar" digitado na Nova OS e na gaveta "Editar OS" | Grava `prazo_execucao`. A Nova OS **não escreve mais** a data prevista; a gaveta tem os dois campos, separados |
| Data agendada da OS recorrente (contrato, por local, "gerar OS") e do PMOC | Continua em `previsao_conclusao`. O prazo só existe se o **tipo de OS** tem prazo padrão |
| Data/hora marcada ao aceitar uma solicitação | Continua em `previsao_conclusao` (a atividade nasce sem tipo → sem padrão) |
| Posição da OS no Calendário (e o que o arrasto muda) | Data prevista; sem ela, o dia do prazo. **O arrasto move a agenda, não o prazo** |
| Mês em "a faturar" | Data prevista; sem ela, o mês do prazo |

O status automático **"Agendada"** continua dependendo só da data prevista (um prazo não agenda nada).

### O prazo padrão do tipo de OS

`tipos_os.prazo_execucao_dias` (opcional): dias contados **do dia agendado, em Brasília**; `0` = o
próprio dia. Preenche o prazo sozinho quando a OS nasce (`prazoAoCriar`):

1. o que a pessoa digitou **vence**;
2. sem nada digitado, o padrão do tipo (se houver dia agendado de onde contar);
3. senão, vazio — e vale a regra do dia previsto.

Quando o **cronograma do PMOC** reagenda uma OS, o prazo próprio anda junto, os mesmos dias
(`deslocarPrazo`). No arrasto do Calendário, não: ali quem decide é a pessoa.

O padrão se configura em **Configurações › Tipos de OS**, no campo "Prazo padrão (dias)" (PR 2).

### Atraso justificado

Colunas `atraso_justificado_*` na OS (motivo de lista + observação + quem + quando) e as regras
(`MOTIVOS_ATRASO`, `atrasoJustificadoSchema`): cliente ausente, peça faltando, acesso negado, clima,
outro (exige explicação).

- **Onde:** no cartão "Prazos" do Resumo da OS — "Justificar atraso", e depois "Alterar" / "Desfazer".
  Rota: `POST` e `DELETE /api/ordens/[id]/atraso-justificado`. Tudo fica no histórico da OS.
- **Quem:** quem tem **Desempenho › Revisar** (`podeJustificarAtraso`) — a mesma pessoa que decide o
  que conta e o que não conta no desempenho. Quem só opera as OS e o técnico não justificam: no app,
  o técnico deixa a observação na execução, e quem justifica é o gestor. Todo mundo que vê a OS lê a
  justificativa.
- **Quando:** só quando há atraso (`haAtrasoParaJustificar`): a OS aberta com o prazo vencido, a OS
  concluída depois do prazo, ou alguma atividade atrasada. O dia de referência da atividade é o MESMO
  do desempenho (`diaDeReferencia`: o prazo próprio ou, sem ele, o dia agendado).
- **O que muda:** a OS **continua atrasada** (no Calendário, na lista, no Dashboard). O atraso só
  deixa de pesar no desempenho de quem executou — isso entra no PR 3.

### O prazo nas telas (PR 2)

| Tela | O que mostra |
|---|---|
| **Lista de OS** | Coluna "Prazo" (a data; selo só quando vence hoje ou atrasou; "justificado" ao lado). Filtro "Prazo": Atrasadas, Vencem hoje, Com atraso justificado (`?prazo=`). A exportação segue o mesmo filtro e traz as colunas do prazo |
| **Sino e Dashboard** | "OS atrasadas" e "Atrasadas" abrem a lista já filtrada (`/ordens?prazo=atrasadas`) |
| **App do técnico** | Selo no cartão e na tela da OS, só quando o escritório DEFINIU um prazo (da atividade ou da OS, o mais próximo): "Prazo 25/11", "Vence hoje", "Atrasada 2 dias". Calculado na hora de mostrar (o cartão fica guardado no aparelho) |
| **Tipos de OS** | Campo e coluna "Prazo padrão" |

### "Prazos e SLA" saiu do menu

Aquela tela não era nenhum dos dois prazos: era o acompanhamento das **etapas com prazo** (fluxos de
etapas, como compra de peça, adicionados à OS). Nada foi apagado:

- o cadastro dos modelos continua em **Configurações › Etapas com prazo** (eram "Modelos de prazo");
- dentro da OS, a seção chama-se "Etapas com prazo" (era "Prazos / SLA");
- o acompanhamento mora em `/ordens/etapas`, sem item de menu: chega-se pelo sino e pelo Dashboard;
- `/prazos` redireciona: com o filtro da tela antiga (`status`, `templateId`) vai para as etapas; sem
  filtro, vai para a lista de OS filtrada nas atrasadas (`lib/os/rota-prazos.ts`).

A palavra "SLA" saiu da interface (um teste varre o código). Ela só continua na proposta de
contrato, que é assunto do PR 4.

## 2. Prazo de atendimento (do contrato)

- É **do contrato**, uma linha por **prioridade** do chamado (as cinco que a OS já tem). O contrato
  configura só as que quiser prometer; cada linha pode ter só "comparecer", só "resolver" ou os dois.
  Prioridade sem linha **não tem prazo** (não se herda de outra).
- Conta da **abertura do chamado** (`chamado_aberto_em`), não da criação da OS.
- **Horas corridas** ou, com "só em horário comercial", só as horas de expediente: **segunda a sexta,
  das 8h às 18h de Brasília** (fixo por enquanto; horário por empresa e feriados ficam para depois).
  Ex.: chamado de sexta às 17h com 4 h vence segunda às 11h.
- Os dois limites são calculados **uma vez**, na abertura, e ficam gravados na OS
  (`atendimento_comparecer_ate`, `atendimento_resolver_ate`): mudar o contrato depois não reescreve o
  que já foi prometido.
- **Comparecer** se cumpre com o "Cheguei" do app (`atendimento_comparecido_em`; reserva: o início da
  primeira atividade). **Resolver**, com a OS concluída — reabrir a OS reabre o prazo.
- Só o **chamado de cliente em contrato** tem prazo de atendimento. A preventiva recorrente não: é a
  empresa que agenda, não há chamado para contar.
- Avisa antes de estourar: nos últimos 20% do prazo, e nunca com menos de 1 hora de antecedência.

Neste PR há o banco e o motor; a configuração no contrato, a gravação dos limites e os alertas
entram no PR 4.

## 3. O corte em PRs

| PR | Conteúdo | Banco |
|---|---|---|
| **1** (este) | Banco e motor dos dois prazos; prazo de execução separado da data prevista em todos os usos; regra única de "atrasada" | 🔵 `prisma/sql/2027-01-09_prazos_execucao_atendimento.sql` |
| **2** (feito) | Prazo de execução nas telas: lista de OS, atraso justificado, app do técnico, prazo padrão no tipo de OS, saída do menu "Prazos e SLA" | 🟢 |
| 3 | Desempenho: atraso justificado fora da métrica "no prazo" | 🟢 |
| 4 | Contrato e OS: configurar o prazo de atendimento, gravar os limites, "Cheguei", alertas | 🟢 |
| 5 | Relatório de cumprimento (tela e PDF) | 🟢 |

## 4. Testes

| Arquivo | O que prova |
|---|---|
| `tests/unit/prazos-motor.test.ts` | As regras puras dos dois prazos e a guarda "a regra de atrasada mora num lugar só" |
| `tests/unit/prazos-pr1-pg.test.ts` | Rotas reais em PostgreSQL real: Nova OS, Editar OS, recorrência, e dashboard = sino = OS a OS |
| `tests/unit/sql-prazos-execucao-atendimento.test.ts` | O SQL de produção: aditivo, idempotente e idêntico ao que o Prisma espera |
| `tests/unit/pmoc-cronograma-pg.test.ts` | PMOC: a OS nasce com o padrão do tipo e o reagendamento leva o prazo |
| `tests/unit/os-central-ui.test.ts`, `padronizacao-leva5-ui.test.ts`, `nova-os-ajustes.test.ts` | As telas: prazo × data prevista nos dois sentidos, os dois campos da gaveta, o campo da Nova OS |
| `tests/unit/prazos-pr2.test.ts` | PR 2, regras puras: filtro de prazo, o que conta como atraso, quem justifica, o prazo do técnico, o prazo padrão do tipo, o menu e a palavra "SLA" |
| `tests/unit/prazos-pr2-pg.test.ts` | PR 2 em PostgreSQL real: lista e exportação filtradas, a rota do atraso justificado (quem, quando, histórico, multiempresa), tipo de OS, cartão do técnico |
| `tests/unit/prazos-pr2-ui.test.ts`, `ordens-lista-barra-ui.test.ts` | PR 2, telas: a gaveta do atraso justificado, o selo do app do técnico, a coluna e o filtro da lista |
