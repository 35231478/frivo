# Calendário (`/calendario`)

Como a tela está montada e de onde vêm as OS que aparecem nela.

## As OS dos contratos nascem sozinhas

O botão "Gerar OS recorrentes do mês" não existe mais. As OS de contrato recorrente são criadas em
dois momentos, sem ninguém clicar:

| Quando | O que gera | Onde |
|---|---|---|
| Ao salvar o contrato (criar ou editar) | as 12 próximas ocorrências, dentro da vigência | `POST/PUT /api/contratos` → `lib/recorrencia-server.ts` |
| Todo dia, na rotina da manhã | as ocorrências que entraram na janela das 12 à frente | `/api/cron/faturar-contratos` → `rolarHorizonteDeOsRecorrentes()` |

Regras da rotina diária (horizonte rolante):

- Vale para contrato **ATIVO** com recorrência — a do contrato **ou** a de algum local. (O botão antigo
  só cobria a recorrência do contrato; a por local parava na 12ª OS.)
- Não repete ocorrência. OS cancelada continua contando como gerada: a rotina não a recria.
- A conferência "já existe?" é feita dentro da transação do número da OS, sob a trava do contador da
  empresa: a rotina e alguém salvando o contrato no mesmo instante não criam a mesma OS duas vezes.
- A OS e o histórico exigem um usuário. A rotina assina com quem gerou a última OS recorrente do
  contrato; se o contrato ainda não tem nenhuma, com o administrador ativo mais antigo da empresa. Empresa
  sem administrador ativo não gera (a resposta do cron conta em `semAutor`).
- Roda **depois** do faturamento e isolada dele: uma falha aqui não atrasa nem derruba o faturamento.
- O histórico da OS diz de onde ela veio: "Gerada automaticamente pela rotina diária do contrato …".

A resposta do cron ganhou `osRecorrentes: { contratos, os, falhas, semAutor }`.

## A tela

Um cartão só, colado no topo, para a grade ficar com a altura da tela:

```
[📅 Calendário ⓘ]  [‹][›] Novembro 2026 [Hoje]                      [↻] [Mês | Semana]
[Cliente][Tipo de OS][Número da OS][Localização / unidade][Técnico][Mais filtros ⌄]   18 ordens de serviço
┌ DOM ┬ SEG ┬ …
```

- **Filtros**: os mesmos 7 (Cliente, Tipo de OS, Número da OS, Localização/unidade, Técnico e, em
  "Mais filtros", Status e Prioridade). O campo vazio mostra o próprio nome (vazio = todos) e cada um
  tem `aria-label`. No celular a faixa começa recolhida atrás do botão "Filtros"; quem chega com
  filtro na URL já a vê aberta. Filtrando, o resumo ("10 de 18", "1 filtro ativo", "Limpar filtros")
  desce para uma linha própria.
- **Atualizar** (`components/calendario/atualizar-calendario.tsx`): busca de novo as OS do período
  (`router.refresh()`), mantendo mês, visão e filtros. Enquanto busca, o ícone gira, o botão fica
  ocupado (`aria-busy`) e não aceita outro clique.
- A semana do fim que só tem dias do mês seguinte não ocupa uma linha.

## A cor do cartão da OS

O cartão inteiro leva a cor do status — fundo claro e contorno do mesmo matiz —, com a bolinha, a
hora e a sigla do técnico. Tudo vem dos tokens (`lib/calendario/cores.ts`):

| Grupo | Status | Fundo / contorno |
|---|---|---|
| Aberta / agendada | Aberta, Aguardando atendimento, Agendada | acento (petróleo) |
| Em andamento | Em andamento, Pausada, Aguardando peça | atenção (âmbar) |
| Concluída | Concluída | OK (verde) |
| Atrasada | qualquer status não finalizado com o prazo vencido | atrasado (vermelho) — vence o status |

Contraste conferido em teste (`tests/unit/calendario-melhorias-ui.test.ts`): nome do cliente, hora e
ícones sobre o fundo do cartão ≥ 4.5:1 (WCAG AA); contorno sobre o branco do dia ≥ 3:1.

No celular cada dia mostra quantas OS tem e um ponto por status presente.

O app interno tem só o tema claro hoje. As cores são classes dos tokens, sem hexadecimal solto: um
tema escuro, quando existir, troca os tokens e precisa repetir a conferência de contraste.

## Hoje

O círculo do dia atual pulsa de leve (`.anim-hoje-pulso`, um anel que se abre e some). Em
`prefers-reduced-motion: reduce` o pulso é desligado e o círculo continua.
