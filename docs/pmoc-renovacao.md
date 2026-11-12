# PMOC — Renovação anual

O PMOC vale um ano. **Renovar** cria, em um clique, o plano da próxima vigência já com o
cronograma, para ninguém remontar as manutenções do zero todo ano.

Etapas anteriores: `docs/pmoc-etapa2-cronograma.md` (cronograma) e
`docs/pmoc-etapa3-documento-alertas-envio.md` (documento, ART, avisos e envio).

## Como funciona

Botão **Renovar** no cabeçalho do plano (ao lado de "Criar cópia"). Abre um diálogo que:

- propõe o **nome** do plano novo (os anos da vigência antiga que estão no nome viram os da nova);
- propõe a **vigência**: início no dia seguinte à expiração do plano atual, expiração um ano depois.
  As duas datas e o nome podem ser mudados antes de confirmar;
- mostra **o que vai** e **o que não vai**, e recalcula a lista quando as datas mudam.

Ao confirmar, o plano novo abre em **Rascunho**. Nenhuma OS é gerada até ele ser publicado.

## O que vai

| O quê | Como |
|---|---|
| Cliente, unidade, responsável técnico (nome e CREA) e texto técnico | Como estão no plano de origem. |
| Equipamentos cobertos | Só os **ativos** no momento da renovação. |
| Cronograma | Todos os itens: tipo de OS, a quem se aplica, intervalo, dia de execução e opção de fim de semana. |

## O que não vai

| O quê | Por quê |
|---|---|
| ART (número e arquivo) | Cada vigência tem a sua. A nova é anexada antes de publicar. |
| Link público, histórico, avisos de vencimento | São do plano antigo. |
| Ocorrências | São o registro do que foi achado na vigência antiga; ficam no plano antigo. |
| OS já geradas | Continuam no plano antigo. |
| Equipamento inativo | E o item do cronograma que era só dele. |
| Item excluído do cronograma | Já não fazia parte do plano. |
| Item que começaria depois da nova expiração | Só acontece quando a vigência é encurtada no diálogo. |

O diálogo lista pelo nome o que fica de fora.

## Para onde vão as datas dos itens

- O item que começava **junto com o plano** (ou antes) começa junto com o plano novo.
- Os demais andam **o mesmo número de meses** que o início do plano andou. Na renovação de um ano,
  isso é o mesmo dia e mês no ano seguinte (01/04/2027 → 01/04/2028).
- Nenhum item começa antes do plano novo.
- Dia que não existe no mês de chegada vira o último dia dele (29/02 → 28/02).

O dia de execução de cada item não muda. O resultado é o mesmo desenho de manutenções do ano
anterior, um ano à frente — inclusive a substituição (a química no lugar da leve).

## Histórico

- No plano **novo**: "Renovado a partir de <plano antigo>", com o que foi levado e o que ficou.
- No plano **antigo**: "Renovação gerada: <plano novo>", com a nova vigência.
- As duas linhas têm um **link** para o outro plano.

A ligação fica na própria linha do histórico (o id do outro plano na última linha dos detalhes), sem
coluna nova no banco. O servidor tira a marca do texto e só devolve o link se o plano for da mesma
empresa.

Um plano que já tem renovação ativa mostra isso no diálogo, com o link. Renovar de novo é permitido
(cria outro plano).

## Renovar × Criar cópia

| | Renovar | Criar cópia |
|---|---|---|
| Para quê | A próxima vigência do mesmo plano | Um plano parecido (outro local, outro cliente) |
| Cronograma | Vai, com as datas deslocadas | Não vai |
| Equipamentos | Só os ativos | Todos |
| Vigência | A próxima, proposta e editável | A mesma do original |
| Histórico | Liga os dois planos | Só no plano novo |
| Permissão | `pmoc.editar` | `pmoc.criar` |

## Permissões

| Ação | Permissão |
|---|---|
| Ver o botão, abrir o diálogo e renovar | `pmoc.editar` |
| Sem o módulo PMOC, e o técnico do app | 403 |

Renovar não exige que o plano esteja publicado, vigente ou ativo: a renovação só lê o plano de
origem e escreve uma linha no histórico dele.

## Onde está

- Regras: `lib/pmoc-renovacao.ts` (datas, o que vai, nome, histórico).
- Servidor: `lib/pmoc-renovacao-server.ts`; rota `/api/pmocs/[id]/renovacao` (GET = prévia, POST = renova).
- Tela: `components/pmoc/pmoc-renovar.tsx`; o link no histórico em `components/pmoc/pmoc-historico.tsx`.
- Banco: nenhuma mudança.
