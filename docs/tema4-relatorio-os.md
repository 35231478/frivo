# Tema 4 — Relatório da OS: card "Equipamentos" e fotos

**Sem mudança de banco.**

## (b) Card "Equipamentos" — corrigido

### Levantamento
- O card ficava na aba **Relatórios & Anexos** da OS e contava **todos os equipamentos ativos da
  unidade do cliente**, atendidos ou não (`app/api/ordens/[id]/relatorios/route.ts`). Numa OS que
  atendeu 2 de uma unidade com 30, dizia 30. OS sem unidade mostrava 0.
- O relatório em si já seguia a regra da Etapa 1 ("só os atendidos"): título "Equipamentos atendidos
  (n)" e um bloco por equipamento atendido (`blocosAtendidos`).

### O que mudou
- O card passa a contar os **atendidos na OS, com a mesma regra do relatório**: equipamento distinto
  marcado como atendido em atividade não cancelada (atendido em duas atividades conta uma vez); em OS
  antiga concluída sem equipamento vinculado, o principal.
- O rótulo vira **"Equipamentos atendidos"** (igual ao número do cabeçalho da OS).

## (a) "O PDF deve mostrar só as fotos da execução" — levantado, com perguntas

### O que o relatório (PDF/impressão) mostra hoje
| Foto | Vai no relatório? |
|---|---|
| Fotos da execução por equipamento (antes / item do checklist / depois) | **Sim** |
| Fotos respondidas em formulário (do equipamento e o geral da atividade) | **Sim** — tiradas pelo técnico na visita |
| Fotos do serviço adicional | **Sim**, na seção "Serviços adicionais" |
| Fotos do **cadastro** do equipamento | **Não** |
| Fotos/anexos enviados pelo **escritório** à galeria da OS | **Não** |
| "Fotos do serviço" tiradas no app (galeria, com legenda) | **Não** |

Ou seja: **não há foto de cadastro nem upload do escritório no PDF**. Deixei isso travado em teste
(com banco real). Não removi nada do relatório porque não ficou claro qual foto estaria sobrando.

### Perguntas para o Zé
1. Qual foto você viu no PDF que não deveria estar? As candidatas são as do **serviço adicional** e
   as de **formulário** — as duas são tiradas na visita. Tiro alguma delas?
2. As **"Fotos do serviço"** que o técnico tira no app (com legenda) hoje **não entram** no PDF.
   Deveriam entrar, já que são da execução?
3. O card **"Fotos"** da mesma aba conta tudo da galeria (execução + adicional + enviadas pelo
   escritório). Deve passar a contar só as da execução, como o de equipamentos?
4. O número "Equipamentos atendidos" do **cabeçalho da OS** conta vínculos (o mesmo equipamento
   atendido em duas atividades conta 2). O card e o relatório contam equipamento distinto. Alinho o
   cabeçalho também?

## Testes
- `tema4-relatorio-os`: a regra pura (atendido, distinto, cancelada, OS antiga) e o card na tela.
- `os-fotos-anexos-pg` (Postgres real, 2 casos novos): o card bate com o relatório em cinco
  situações (unidade com 3, vinculado sem atender, mesmo equipamento em duas atividades, segundo
  atendido, atividade cancelada); e o relatório não leva foto do cadastro nem do escritório.

## Prints
`docs/prints/tema4-relatorio-os/` — desktop e celular: a aba com o card e o relatório da OS.
