# Contas a pagar recorrentes — a despesa que se repete

Aluguel, internet, assinatura, salário, contador: a despesa que cai todo mês deixa de ser digitada
doze vezes. A pessoa cria **uma regra** e o sistema gera **uma conta a pagar por competência**.

Este documento é da **parte 1 (servidor)**. A parte 2 (telas) vem num PR separado.

---

## O corte: P1 (servidor) × P2 (telas)

O escopo pedido é grande, então ele veio em duas partes — aprovado antes de codar:

| | O que entra | Estado |
| --- | --- | --- |
| **P1** | Banco (🔵), motor de datas, geração com trava, horizonte no cron, pausar/retomar/encerrar, pular ocorrência, editar com escopo, tornar avulsa em recorrente, rotas e testes | **este PR** |
| **P2** | Toggle "Repetir (recorrente)" na Nova conta a pagar, diálogo de alcance ao editar, tela "Despesas recorrentes", selos "recorrente" e "a confirmar", prints desktop e celular | próximo PR |

**P1 não toca nenhuma tela.** Nada muda para quem usa o sistema hoje: as telas atuais continuam
idênticas, e nenhuma conta a pagar existente é alterada. O que entra é a máquina embaixo (banco,
regras, rotas, cron) mais os testes dela.

---

## Duas premissas do pedido que o levantamento corrigiu

1. **"parcelas da conta a pagar"** — a conta a pagar **não tem parcelas** no sistema hoje. Parcela é
   coisa de Contas a **Receber** (`parcelas`/cobrança). Então nada foi reaproveitado de parcela: a
   ocorrência da recorrente é uma **conta a pagar inteira e independente**, com número próprio,
   baixa própria e histórico próprio. É também o desenho certo: a despesa recorrente não é um valor
   dividido, é o mesmo valor que volta.
2. **"ajuste de dia não útil"** — não existe tabela de feriados no sistema. O ajuste que existe (e
   que o contrato recorrente já usa) é de **fim de semana**: `ADIANTAR` (sexta), `POSTERGAR`
   (segunda) ou `MANTER`. A recorrente usa exatamente esse. Feriado fica anotado na Fase 2.

---

## O que já existia e foi reusado (nada de caminho paralelo)

| Peça | Onde já estava | Como a recorrente usa |
| --- | --- | --- |
| Soma de meses, "dia do mês" que respeita fim de mês, ajuste de fim de semana | `lib/financeiro/contrato-previsao.ts` (`somarMeses`, `diaDoMes`, `ajustarFimDeSemana`) | importados direto; nenhuma função de data nova |
| Uma linha por competência + índice único `(regra, ano, mês)` | contrato recorrente: `@@unique([contratoId, refAno, refMes])` | mesmo desenho: `@@unique([recorrenciaId, refAno, refMes])` |
| Horizonte rolante de ~12 meses empurrado por cron | `rolarHorizonteDePrevisoes()` no cron `faturar-contratos` | o mesmo cron ganhou o passo 2, `rolarHorizonteDeRecorrentes()` |
| Numeração da conta a pagar | `proximoNumeroContaPagar()` | cada ocorrência gerada tira um número do contador da casa |
| Recálculo de saldo/status da conta | `recalcularContaPagar()` | intocado: a baixa da ocorrência é a baixa normal da conta a pagar |
| Permissão do dinheiro | `exigirPermissao("financeiro", "fluxoCaixa")` | mesma permissão de criar/editar conta a pagar |

Arquivos novos: dois (`lib/financeiro/conta-pagar-recorrencia.ts`, regras puras, e
`...-server.ts`, o servidor). Nenhuma função existente mudou de comportamento.

---

## Banco — 🔵 aplicar antes do merge

Arquivo: **`prisma/sql/2027-01-04_contas_pagar_recorrentes.sql`** (aditivo e idempotente).

- **1 tabela nova**, `contas_pagar_recorrencias`: a regra. Nasce vazia.
- **5 colunas novas, todas opcionais, em `contas_pagar`**: `recorrencia_id`, `ref_ano`, `ref_mes`,
  `valor_estimado` (BOOLEAN default false) e `tecnico_id`. As contas que já existem ficam como
  estão — NULL nas três primeiras, `false` no estimado, NULL no colaborador.
- **1 índice ÚNICO** `(recorrencia_id, ref_ano, ref_mes)`: é ele que impede gerar a mesma conta duas
  vezes. Como as colunas são NULL nas contas avulsas, o índice não as alcança (no Postgres NULL não
  conflita com NULL).
- Chaves estrangeiras criadas só quando ainda não existem (`DO $$` + `pg_constraint`).
- Nenhuma tabela perde ou muda coluna. Nenhum dado é reescrito. Sem enum novo (situação e ajuste são
  TEXTO, como no fechamento do Desempenho).

Por que coluna em `contas_pagar` e não uma tabela de ligação: a ocorrência **é** a conta a pagar. Uma
tabela intermediária criaria um segundo lugar para a mesma verdade.

---

## As regras (o que o motor garante)

- **O valor é o de cada ocorrência e não multiplica.** Trimestral de R$ 900 = R$ 900 a cada 3 meses.
- **Frequência**: mensal, bimestral, trimestral, quadrimestral, semestral, anual, ou "a cada N
  meses" (1 a 60).
- **Início**: mês corrente se o dia de vencimento ainda não passou; mês seguinte se já passou. É
  sugestão — a pessoa escolhe. Competência passada nunca nasce.
- **Término**: por competência final, por número de ocorrências, ou indefinido (aí vale o horizonte
  rolante de 12 meses). Os dois primeiros não se combinam; o término não pode ser antes do início.
- **Valor estimado** ("a confirmar"): energia, água, cartão. A conta nasce com o valor previsto e a
  pessoa ajusta quando o boleto chega — a marca viaja da regra para a conta.
- **Favorecido**: fornecedor **ou** colaborador (salário, pró-labore). Um dos dois é obrigatório.
- **Herança**: categoria, centro de custo, forma de pagamento, descrição e observação descem da
  regra para cada ocorrência.
- **Descrição da ocorrência**: `Aluguel do galpão — jan/2026`.

## Dinheiro é razão

Nada é apagado, em nenhum caminho:

| Ação | O que acontece |
| --- | --- |
| **Pular** uma ocorrência | a conta daquele mês fica **CANCELADO** (status, nunca delete) e a regra continua; o mês seguinte nasce normalmente |
| **Pausar** a regra | para de gerar e cancela as ocorrências **futuras ainda em aberto** |
| **Retomar** | volta a valer e regera do mês corrente em diante |
| **Encerrar** (é o que "excluir" faz) | regra `ENCERRADA` com data e motivo; cancela as futuras em aberto; o histórico fica inteiro |
| **Editar a regra** | as futuras em aberto acompanham; se o término encolheu, as que ficaram fora são canceladas; se cresceu, as que passaram a caber nascem |
| **Conta paga ou parcialmente paga** | **nunca** muda por edição de regra, por pausa ou por encerramento. Tentar devolve 409 "Conta já paga não muda: lance um estorno ou um ajuste." |
| **Tornar avulsa em recorrente** | a conta **não** é recriada: continua com o número, os pagamentos e o histórico dela, e passa a ser a primeira ocorrência |

Cada conta gerada é independente: pagar, ajustar o valor ou cancelar uma não mexe na regra nem nas
outras.

## Editar com escopo

Ao editar uma conta que veio de uma regra, o alcance é explícito:

- **"Só esta ocorrência"** — o ajuste vale só para aquele mês. A regra continua como está. (É o
  caminho de sempre: sem escopo no corpo, a conta é tratada como qualquer conta a pagar.)
- **"Esta e as próximas em aberto"** — muda a regra **daqui para a frente** (valor e dia do
  vencimento) e repassa às contas futuras que ainda não foram pagas. As já pagas não mudam. O início
  da regra só anda para a frente: competência anterior não é reescrita.

## Geração e a trava

`gerarContasDaRecorrencia()` é idempotente de duas maneiras, de propósito:

1. **antes** de criar, lê o que já existe nas competências-alvo e pula o que tem (não queima número
   de conta a pagar à toa);
2. **depois**, se duas rodadas correrem ao mesmo tempo, o índice único recusa com `P2002` e a
   competência é pulada em silêncio.

Um teste de mutação cobre exatamente isso: sem o passo 1 o banco ainda fica certo (o índice segura),
mas o contador de numeração anda à toa — então o teste mede o contador, não só as linhas.

O cron diário (`/api/cron/faturar-contratos`, `Bearer CRON_SECRET`) ficou com três passos: horizonte
das previsões dos contratos, **horizonte das despesas recorrentes**, faturamento automático. Uma
regra que falha não derruba as outras (`falhas` no retorno).

---

## Rotas (todas em `Financeiro › Fluxo de caixa`, menos a leitura)

| Rota | Método | Permissão | O que faz |
| --- | --- | --- | --- |
| `/api/contas-pagar/recorrencias` | GET | `financeiro.visualizar` | lista as regras (com contagem de ocorrências) |
| `/api/contas-pagar/recorrencias` | POST | `financeiro.fluxoCaixa` | cria a regra e já gera as contas |
| `/api/contas-pagar/recorrencias/[id]` | GET | `financeiro.visualizar` | a regra e as ocorrências dela |
| `/api/contas-pagar/recorrencias/[id]` | PUT | `financeiro.fluxoCaixa` | edita a regra |
| `/api/contas-pagar/recorrencias/[id]` | DELETE | `financeiro.fluxoCaixa` | **encerra** (não apaga) |
| `/api/contas-pagar/recorrencias/[id]/acao` | POST | `financeiro.fluxoCaixa` | `PAUSAR` \| `RETOMAR` \| `ENCERRAR` \| `GERAR` |
| `/api/contas-pagar/[id]/pular` | POST | `financeiro.fluxoCaixa` | pula (cancela) uma ocorrência |
| `/api/contas-pagar/[id]` | PUT | `financeiro.fluxoCaixa` | ganhou o campo `escopo` opcional |

Multiempresa: toda leitura e toda escrita filtram por `empresaId` da sessão. Nada hardcoded.

---

## Testes

| Arquivo | Testes | O que prova |
| --- | --- | --- |
| `tests/unit/conta-pagar-recorrencia.test.ts` | 20 | motor puro: frequências, competências, término por data e por número, vencimento com fim de semana e fim de mês, escopo, validação |
| `tests/unit/conta-pagar-recorrencia-pg.test.ts` | 16 | PostgreSQL real: gerar sem duplicar (inclusive duas rodadas ao mesmo tempo), pausar/retomar/encerrar, pular, editar com escopo, conta paga intocada, avulsa → recorrente, permissão e isolamento por empresa |
| `tests/unit/sql-contas-pagar-recorrentes.test.ts` | 8 | o SQL de produção roda duas vezes seguidas sem erro, cria o índice **único**, deixa as colunas opcionais e casa com o schema do Prisma |

Rodada de mutação: **9 de 9 pegas** (dedup, escopo alcançando conta paga, escopo alcançando o
passado, encerrar apagando em vez de cancelar, pausa que não para a geração, ajuste de fim de semana
perdido, índice único virando índice comum, coluna nova nascendo NOT NULL, rota sem a permissão do
dinheiro).

---

## Fase 2 (anotado, não feito)

- **Reajuste automático anual** (IGPM/IPCA na data de aniversário da regra) — o contrato recorrente
  já tem reajuste; a recorrente herdaria o mesmo desenho.
- **Boleto automático por ocorrência (DDA)** — hoje o boleto é anexado por conta, uma a uma.
- **Feriados** no ajuste de dia não útil — precisa de uma tabela de feriados (nacional + município
  da empresa), que o sistema não tem.

## Pergunta em aberto (não chutei)

Ao **pausar** ou **encerrar**, hoje só as ocorrências de competência **futura** em aberto são
canceladas: a do **mês corrente** fica. A ideia é que a conta deste mês provavelmente já está no
fluxo de caixa e pode até já ter boleto. Se o certo for cancelar o mês corrente também, é uma linha
(`competenciaCorrente()` → competência anterior) e um teste.
