# PMOC — Etapa 2: cronograma que gera as OS

A aba **Cronograma** do PMOC diz o que fazer, em quais equipamentos e de quanto em quanto tempo. A
partir dela o sistema gera as OS de manutenção preventiva e as mantém iguais ao cronograma.

Não faz parte desta etapa: PDF do plano, alertas, WhatsApp, portal do cliente (Etapa 3).

## Banco

`prisma/sql/2026-12-10_pmoc_etapa2_cronograma.sql` — duas tabelas novas, aditivo e idempotente.
Nenhuma coluna em tabela existente (nem em `ordens_servico`); nenhum enum.

| Tabela | O que guarda |
|---|---|
| `pmoc_cronogramas` | Um item do cronograma: a quem se aplica, tipo de OS, data de início, a cada N meses, dia de execução. |
| `pmoc_execucoes` | Uma linha por (item, equipamento, competência `AAAA-MM`), ligada à OS gerada. A chave única é o que impede OS duplicada. |

## O item do cronograma

| Campo | Regra |
|---|---|
| Aplica-se a | Todos os equipamentos do plano, um tipo de equipamento, ou um equipamento. |
| Tipo de OS | Do cadastro de tipos de OS (define o serviço e o checklist). |
| Data de início | A primeira execução é o primeiro "dia de execução" nessa data ou depois dela. |
| Frequência / a cada N meses | Mensal, bimestral, trimestral, semestral, anual, ou qualquer número de meses (1 a 60). |
| Dia de execução | 1 a 28 (existe em todo mês), como na recorrência dos contratos. |

## O que vira OS

- **Uma OS por item, competência e local** (endereço do cliente), com uma atividade que leva todos
  os equipamentos daquele item naquele local.
- A OS nasce como a recorrente dos contratos: número pelo contador, status Agendada, origem
  Recorrente, atividade com o tipo de OS e a data ao meio-dia. Por isso entra no calendário e na
  lista de OS sem nada a mais.
- A OS **não** nasce com técnico: aparece como "sem quem execute" para o escritório distribuir.
- No resumo da OS aparece o atalho para o plano.

## Quando gera

| Situação | Gera? |
|---|---|
| Plano em rascunho | Não. O cronograma pode ser montado; as OS nascem ao publicar. |
| Plano publicado e vigente | Sim: ao publicar e a cada vez que o cronograma (ou o plano) é salvo. |
| Plano expirado | Não gera mais. Nunca há OS depois da data de expiração. |
| Plano inativo | Não. |
| Equipamento inativo | Não entra em OS nova. |
| Data no passado | Nunca. |

A geração automática **só cria** o que falta. Mudar datas, retirar equipamento e cancelar OS só
acontecem em **Reagendar atividades**, depois de uma confirmação que diz o que vai mudar.

## Reagendar atividades

Deixa a agenda igual ao cronograma. Só mexe em OS que **ainda não começou** (aberta ou agendada,
atividade agendada, equipamento não atendido, data de hoje em diante).

| O que mudou | O que o reagendamento faz |
|---|---|
| Dia de execução ou data de início | Muda a data da OS — a menos que alguém já tenha mudado a data à mão, ou que a data nova caia no passado. |
| Equipamento inativado ou tirado do plano | Tira o equipamento das OS futuras. |
| Equipamento novo no plano | Entra na OS aberta do mesmo item, competência e local; noutro local, ganha OS própria. |
| Item excluído, frequência menor, plano encurtado | As competências que deixaram de existir saem da agenda. |
| OS que fica sem equipamento | É cancelada (não apagada), com o motivo no histórico. Exige "Ordens de serviço › Excluir". |

Rodar de novo não duplica nada: cada (item, equipamento, competência) existe uma vez só, e a
aplicação roda sob uma trava por plano.

OS cancelada ou apagada à mão **não** é gerada de novo: a execução continua registrada.

## Permissões

| Ação | Permissão |
|---|---|
| Ver a aba, os itens e as OS geradas | `pmoc.visualizar` |
| Criar, editar e excluir item; Reagendar atividades | `pmoc.editar` |
| Cancelar OS vazia no reagendamento | `pmoc.editar` **e** `ordens.excluir` |
| Abrir a OS pela lista da aba | `ordens.visualizar` (sem ela, o número aparece sem link) |

## Onde está

- Regras puras: `lib/pmoc-cronograma.ts` (datas, a quem se aplica, o plano de reagendamento).
- Servidor: `lib/pmoc-cronograma-server.ts` (carrega, aplica, lê para a aba) e `lib/pmoc-cronograma-rotas.ts`.
- Rotas: `/api/pmocs/[id]/cronograma`, `/cronograma/[itemId]`, `/cronograma/reagendar`.
- Tela: `components/pmoc/pmoc-cronograma.tsx`.
- Reaproveitado dos contratos: `proximasOcorrencias` (agora aceita "a cada N meses"), a numeração
  da OS, a origem Recorrente e o campo de competência.
