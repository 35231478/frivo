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

Na **Nova OS** o prazo aparece **sugerido no próprio campo** assim que há tipo e agendamento, com o
aviso "Sugerido pelo tipo de OS: N dias após o agendamento", e acompanha os dois enquanto a pessoa não
mexe. Depois que ela digita, vale o que ela pôs (há um atalho para voltar ao sugerido). Se ela
**apaga** a sugestão, a OS nasce sem prazo próprio: a tela manda `usarPrazoPadrao: false` e o servidor
não reaplica o padrão. Quem cria a OS sem passar pela tela (recorrência, PMOC, integrações) continua
recebendo o padrão direto do servidor.

### Atraso justificado

Colunas `atraso_justificado_*` na OS (motivo de lista + observação + quem + quando) e as regras
(`MOTIVOS_ATRASO`, `atrasoJustificadoSchema`): cliente ausente, peça faltando, acesso negado, clima,
outro. Em "Outro" a explicação é obrigatória e precisa dizer alguma coisa — "razão é razão": pelo
menos 5 caracteres, sem contar espaços nas pontas. A OS justificada ganha o selo "Atraso
justificado" no cabeçalho e "Justificado" na lista.

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
  deixa de pesar no desempenho de quem executou — ver abaixo.

### O atraso justificado no desempenho (PR 3)

- A atividade **concluída com atraso** de uma OS justificada **sai da métrica "no prazo"**: nem acerto
  nem erro, como o que não dá para medir (`lib/desempenho/regras.ts` › `medirAtividades`). O escore
  sobe porque o atraso deixou de contar — nunca porque virou acerto ("1 de 2", não "2 de 3").
- **Só o atraso sai.** A atividade no prazo da mesma OS continua contando a favor; o relatório e a
  avaliação são medidos igual. Quem só tem atraso justificado fica **sem medição** no prazo (não é
  zero nem 100): o peso vai para as outras métricas.
- A justificativa é **da OS**: vale para todas as atividades atrasadas dela, para cada executor (uma
  vez cada) e para o encarregado da equipe.
- **Na ficha**, a composição diz quantos ficaram fora — "1 de 2 atividades · 1 atraso justificado
  fora da conta" — e a seção **Atrasos justificados** mostra cada um: a OS, "Prazo dd/mm/aaaa ·
  concluída em dd/mm/aaaa (N dias depois)", o motivo, a explicação e quem justificou e quando. O
  atraso não some: fica visível e rotulado. Os atrasos que **contam** ficam numa segunda seção
  ("Atrasos que contam", só quando há algum) — é por ela que a gestão chega à OS para justificar.
  No painel, o número abre a OS; no app do técnico não há link, e o colaborador vê só o **motivo**
  da lista — a explicação escrita e quem justificou não saem do servidor para o app
  (`fichaParaOColaborador`).
- **Uma regra só, um caminho só.** O que conta como atraso da atividade está escrito num lugar
  (`concluidaNoPrazo`, em `lib/desempenho/regras.ts`): a medição do desempenho e o botão "Justificar
  atraso" da OS (`atividadeAtrasou`) chamam a mesma função. Ficha, ranking, app do técnico, modo TV
  e fechamento leem o mesmo painel (`medirMes` → `montarPainel`); nenhuma tela refaz a conta. Um
  teste de fonte trava as duas coisas. A regra `osAtrasada` é a da OS **aberta** (calendário, lista,
  sino); o desempenho sempre mediu a atividade **concluída** contra o dia de referência dela.
- **Mês fechado não muda.** O painel do mês fechado é o que foi gravado no fechamento (inclusive a
  lista de atrasos): justificar ou desfazer depois não mexe em escore, faixa, bônus nem na lista.
  Quem justifica é avisado na OS — "O desempenho de 10/2026 já está fechado…" — e, para valer,
  reabre o mês em Desempenho › Fechamento (`competenciasDosAtrasos`, `avisoMesFechado`). Mês fechado
  antes de a lista existir simplesmente não mostra as seções.
- A TV e a folha de bônus não recebem nada disso; o desempate da premiação conta os **acertos** (o
  atraso justificado não é acerto).

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

A palavra "SLA" saiu da interface (um teste varre o código) — inclusive da proposta de contrato, que
desde o PR 4 fala em "Prazo de atendimento".

## 2. Prazo de atendimento (do contrato)

- É **do contrato**, uma linha por **prioridade** do chamado (as cinco que a OS já tem). O contrato
  configura só as que quiser prometer; cada linha pode ter só "comparecer", só "resolver" ou os dois.
  Prioridade sem linha **não tem prazo** (não se herda de outra).
- Conta da **abertura do chamado** (`chamado_aberto_em`), não da criação da OS.
- **Horas corridas** ou, com "só em horário comercial", só as horas de expediente **da empresa**.
  Ex. na jornada padrão: chamado de sexta às 17h com 4 h vence segunda às 11h; na empresa que abre
  sábado de manhã, vence sábado às 11h.
- Os dois limites são calculados **uma vez** e ficam gravados na OS (`atendimento_comparecer_ate`,
  `atendimento_resolver_ate`): mudar o contrato depois não reescreve o que já foi prometido.
- **Comparecer** se cumpre com o "Cheguei" do app (`atendimento_comparecido_em`; reserva: o início da
  primeira atividade). **Resolver**, com a OS concluída — reabrir a OS reabre o prazo.
- Só o **chamado de cliente em contrato** tem prazo de atendimento. A preventiva recorrente não: é a
  empresa que agenda, não há chamado para contar.
- Avisa antes de estourar: nos últimos 20% do prazo, e nunca com menos de 1 hora de antecedência.

O banco e o motor vieram no PR 1. O PR 4 ligou tudo:

### O horário comercial é de cada empresa (PR 4)

Até o PR 4 o expediente estava escrito no código (segunda a sexta, 8h–18h, igual para todos). Agora
é a **jornada semanal da empresa**: em cada dia da semana, se há expediente e de que hora a que hora.

- **Onde configura:** Configurações › Operacionais › **Horário comercial** (ver: Configurações ›
  visualizar; mudar: Configurações › gerenciar).
- **Onde fica:** `configuracoes.horario_comercial` (JSON, opcional) —
  `{ "dias": [ { "dia": 1, "inicio": "08:00", "fim": "18:00" }, … ] }`, `dia` de 0 (domingo) a 6
  (sábado), só os dias com expediente. **Vazio = segunda a sexta, 8h–18h** (o que valia antes), por
  isso o SQL não preenche nada (`prisma/sql/2027-01-10_horario_comercial_empresa.sql`).
- **Quem lê:** só `jornadaDaEmpresa` (`lib/atendimento/prazo-server.ts`), na hora de fixar os limites
  de um chamado cuja promessa conta "só em horário comercial". Mudar a jornada vale **dali em
  diante**: os limites já gravados nas OS não mudam.
- **Feriados** não entram aqui (cadastro de feriados, frente à parte).

### No contrato

Aba **Escopo e locais** › seção **Prazo de atendimento**. Começa simples — "Comparecer em ___ horas"
e "Resolver em ___ horas" para todo chamado — e "Definir por prioridade do chamado" abre as cinco
prioridades (já com o prazo que estava). O marcador "Contar só em horário comercial" vale para o
contrato inteiro e mostra, por extenso, o horário da empresa. Campo em branco = o contrato não
promete aquilo. Salvar o contrato **nunca mexe em OS**.

A **proposta de contrato** aprovada vira contrato já com o que prometeu: o "atendimento emergencial
em X horas" vira o comparecimento das prioridades Alta, Urgente e Crítico; o "atendimento normal em
Y horas", o de Baixa e Normal — em horas corridas (o "horário de atendimento" da proposta é texto
livre e não é copiado). No contrato dá para ajustar.

### Na OS

| Momento | O que acontece |
|---|---|
| Cliente abre o chamado (Portal ou QR Code) | Grava `chamado_aberto_em`. Ainda não há contrato nem limite. Pedido de orçamento pelo QR não é chamado de atendimento |
| A equipe **aceita** o chamado (define contrato e prioridade) | `fixarLimitesDaOs` grava "comparecer até" e "resolver até", contados **da abertura** — não do aceite |
| OS lançada à mão com contrato | "Chamado do cliente" + "Chamado aberto em" (não pode estar no futuro); nasce com os limites |
| Mudou a prioridade, o contrato ou a hora de abertura **na OS** | Os limites são refeitos. Editar qualquer outro campo não refaz |
| Mudou o contrato ou o horário comercial | Nada muda nas OS que já têm limites |
| Técnico toca **"Cheguei"** no app (o mesmo botão de sempre) | Grava `atendimento_comparecido_em` com a hora do toque, uma vez só. "A caminho" não grava. Reserva: o início da atividade |
| OS concluída | Resolver cumprido (no prazo ou com atraso) |

A central da OS mostra o cartão **Prazo de atendimento** ("Comparecer até …", "Resolver até …", cada
um com o estado em palavra e cor) separado do cartão **Prazo de execução**, e um selo no cabeçalho
só quando o prazo está vencendo ou estourado. A cor diz o estado: neutro com folga, âmbar perto do
limite, vermelho estourado, verde cumprido no prazo.

**OS encerrada não tem relógio correndo.** Concluída sem chegada registrada: se terminou até o limite
de comparecer, o técnico chegou antes dele (cumprido); se terminou depois, não há como saber quando
chegou — aparece "sem registro", sem afirmar atraso que ninguém mediu. Cancelada: o que estava em
aberto fica "sem registro".

### Alertas

Pelo **sino** que já existia: "Prazo de atendimento estourado" e "Prazo de atendimento vencendo" (só
aparecem quando há algum), cada um abrindo a lista de OS já filtrada (`/ordens?atendimento=…`). A
lista ganhou o filtro **Prazo de atendimento**; o que já existia passou a se chamar **Prazo de
execução**. Quem recebe: quem vê as OS (Ordens de serviço › visualizar), só da própria empresa.

### A regra mora num lugar só

| O quê | Onde | Ninguém mais |
|---|---|---|
| Somar horas (corridas ou de expediente) e calcular os limites | `somarHoras`, `limitesDoAtendimento` em `lib/atendimento/prazo.ts` | chama fora de `lib/atendimento` |
| Gravar os limites e o comparecimento na OS | `fixarLimitesDaOs`, `marcarComparecimento` em `lib/atendimento/prazo-server.ts` | lê nem escreve esses campos |
| Situação e alerta de uma OS | `atendimentoDaOs`, `alertaDoAtendimento` | compara limite com a hora de agora |
| Sino e filtro da lista | `contarAtendimento`, `idsPorAtendimento` | conta por conta própria |

`tests/unit/prazos-pr4.test.ts` varre o código e falha se alguém fizer a conta por fora.

## 3. O corte em PRs

| PR | Conteúdo | Banco |
|---|---|---|
| **1** (este) | Banco e motor dos dois prazos; prazo de execução separado da data prevista em todos os usos; regra única de "atrasada" | 🔵 `prisma/sql/2027-01-09_prazos_execucao_atendimento.sql` |
| **2** (feito) | Prazo de execução nas telas: lista de OS, atraso justificado, app do técnico, prazo padrão no tipo de OS, saída do menu "Prazos e SLA" | 🟢 |
| **3** (feito) | Desempenho: atraso justificado fora da métrica "no prazo", "Atrasos justificados" na ficha, mês fechado intocado | 🟢 |
| **4** (feito) | Contrato e OS: configurar o prazo de atendimento, gravar os limites, "Cheguei", alertas; horário comercial por empresa | 🔵 `prisma/sql/2027-01-10_horario_comercial_empresa.sql` |
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
| `tests/unit/prazos-pr3.test.ts` | PR 3, regras puras: o atraso da atividade, o que sai da conta, o texto da composição, a linha do painel, a TV sem atrasos, os meses em que a justificativa pesa e o aviso de mês fechado |
| `tests/unit/prazos-pr3-pg.test.ts` | PR 3 em PostgreSQL real: justificar tira da conta e desfazer devolve; só o atraso sai; equipe e encarregado; mês fechado não muda e reabrir faz valer; o que o colaborador vê no app; multiempresa |
| `tests/unit/prazos-pr3-ui.test.ts` | PR 3, telas: "Atrasos do mês" na ficha e no app, e o aviso de mês fechado na OS |
| `tests/unit/prazos-pr4.test.ts` | PR 4, regras puras: a jornada por empresa, a abertura digitada, o alerta, a OS encerrada, proposta → contrato, o formulário — e a trava "ninguém calcula nem grava por fora" |
| `tests/unit/prazos-pr4-pg.test.ts` | PR 4 em PostgreSQL real: contrato (gravar, trocar, não apagar, RBAC), chamado → aceite → limites desde a abertura, OS manual e edição, horário comercial por empresa, "Cheguei" (uma vez, hora do toque), sino, lista e exportação |
| `tests/unit/prazos-pr4-ui.test.ts`, `contrato-form-ui.test.ts`, `ordens-lista-barra-ui.test.ts` | PR 4, telas: a seção do contrato, o cartão e o selo da OS, Configurações › Horário comercial, o sino e o filtro da lista |
| `tests/unit/sql-horario-comercial.test.ts` | O SQL do horário comercial: uma coluna opcional, nada preenchido, idempotente e idêntico ao que o Prisma espera |
