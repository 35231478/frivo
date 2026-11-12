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

Etapa 2.1 — `prisma/sql/2026-12-12_pmoc_cronograma_fim_semana.sql`: uma coluna,
`pmoc_cronogramas.fim_semana`, do tipo que os contratos já usam (`TratamentoFimSemana`), `NOT NULL
DEFAULT 'MANTER'`. Aditivo e idempotente; não cria nem altera enum. A substituição não tem banco.

## O item do cronograma

| Campo | Regra |
|---|---|
| Aplica-se a | Todos os equipamentos do plano, um tipo de equipamento, ou um equipamento. |
| Tipo de OS | Do cadastro de tipos de OS (define o serviço e o checklist). |
| Data de início | A primeira execução é o primeiro "dia de execução" nessa data ou depois dela. |
| Frequência / a cada N meses | Mensal, bimestral, trimestral, semestral, anual, ou qualquer número de meses (1 a 60). |
| Dia de execução | 1 a 28 (existe em todo mês), como na recorrência dos contratos. |
| Se cair no fim de semana | Manter, adiantar para a sexta-feira ou postergar para a segunda-feira (Etapa 2.1). |

## Substituição: um serviço por equipamento no mês (Etapa 2.1)

O mesmo plano costuma ter serviços em camadas: a preventiva leve todo mês e a limpeza química a
cada 3 ou 6 meses. No mês em que as duas coincidem, o equipamento recebe **uma OS só**.

- Para o mesmo **equipamento** na mesma **competência** (`AAAA-MM`), só gera o item de **maior
  intervalo** (o serviço menos frequente, mais profundo). Os outros não geram para aquele
  equipamento naquele mês.
- **Desempate** (mesmo intervalo): vale o item **criado primeiro**; no mesmo instante, o de menor id.
- É **por equipamento**: se a química cobre só alguns, cada equipamento resolve sozinho. A OS da
  leve continua existindo no mês, sem os equipamentos que foram para a química.
- Se a OS de um item fica **sem equipamento** no mês, ela não é criada.
- Vale a competência do dia de execução, não o dia: leve no dia 10 e química no dia 25 do mesmo
  mês ainda é uma OS só.
- Só disputa a execução que existe ou ainda pode existir: a que já foi gerada, ou a que tem data
  de hoje em diante. Uma data que passou sem nunca ter virado OS não substitui ninguém.
- A execução já gerada continua valendo como o serviço do mês mesmo que a OS dela seja cancelada à
  mão: o serviço substituído não volta sozinho.

Quando o item de maior intervalo entra **depois** de as OS já terem sido geradas, salvar só cria a OS
dele. A OS do item substituído sai da agenda em "Reagendar atividades" (a aba mostra a pendência
até lá): o equipamento é retirado e, se a OS ficar vazia, ela é cancelada — com o serviço que a
substituiu no histórico. É idempotente: reagendar de novo não recria nem cancela mais nada.

O checklist vem do tipo de OS. Como o serviço mais profundo **substitui** a rotina leve naquele mês,
o checklist do tipo de OS dele deve conter também os itens da rotina leve. A aba diz isso na dica
do campo "Tipo de OS"; não há configuração nova.

Na lista de itens, cada item mostra quantas execuções ele cede ("4 execuções substituídas"), e a
coluna "Próxima" já desconta a substituição.

## Fim de semana (Etapa 2.1)

A opção é **por item** e usa a mesma regra da recorrência de OS dos contratos
(`ajustarFimDeSemana`, em `lib/recorrencia-helpers.ts`):

| Opção | Sábado | Domingo |
|---|---|---|
| Manter na data original | fica | fica |
| Adiantar para sexta-feira | sexta | sexta |
| Postergar para segunda-feira | segunda | segunda |

- O formulário propõe **postergar** nos itens novos. Os itens gravados antes da opção ficam em
  **manter**: nada muda neles nem nas OS já geradas.
- A competência continua sendo o mês do dia de execução, mesmo quando a data ajustada cai no mês
  vizinho (dia 28 num domingo, postergado, vai para o dia 1º — e segue sendo a execução daquele mês).
- O ajuste respeita os limites: adiantar para antes do início do item, ou postergar para depois da
  expiração do plano, não gera.
- Feriados não entram na conta.
- Trocar a opção num item já gerado não mexe na agenda ao salvar; "Reagendar atividades" leva as OS
  que ainda não começaram para a data nova.

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
| Dia de execução, data de início ou opção de fim de semana | Muda a data da OS — a menos que alguém já tenha mudado a data à mão, ou que a data nova caia no passado. |
| Entrou um item de maior intervalo no mesmo mês (substituição) | O equipamento sai da OS do item substituído; o histórico da OS diz qual serviço passou a atendê-lo. OS já iniciada ou concluída fica como histórico. |
| Equipamento inativado ou tirado do plano | Tira o equipamento das OS futuras. |
| Equipamento novo no plano | Entra na OS aberta do mesmo item, competência e local; noutro local, ganha OS própria. |
| Item excluído, frequência menor, plano encurtado | As competências que deixaram de existir saem da agenda. |
| OS que fica sem equipamento | É cancelada (não apagada), com o motivo no histórico — inclusive "substituída por <serviço> nesta competência". Exige "Ordens de serviço › Excluir". |

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
