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

## O status no cartão da OS

A cor é **acento, não fundo**. O cartão é neutro (cinza levíssimo sobre o branco do dia, um tom acima
no hover), sem contorno e sem sombra; só uma **barra fina (3 px) à esquerda** leva a cor do status.

### O que cada cor significa

Quatro cores, uma por grupo de status, todas dos tokens da identidade (`lib/ui/tokens.ts`). Nunca cor
por técnico nem por tipo de OS.

| Cor | Token | Significa | Status que entram |
|---|---|---|---|
| Petróleo | `acento` | **Aberta / agendada** — ainda vai acontecer | Aberta, Aguardando atendimento, Agendada |
| Âmbar | `atencao` | **Em andamento** — começou e não terminou | Em andamento, Pausada, Aguardando peça |
| Verde | `ok` | **Concluída** | Concluída |
| Vermelho | `atrasado` | **Atrasada** — prazo vencido e não finalizada; vence o status | qualquer um dos de cima, com o prazo vencido |

OS cancelada não aparece no calendário (se aparecesse, a barra seria cinza, `previsto`).

"Prazo vencido" é o **prazo de execução** da OS — o próprio ou, sem ele, o dia previsto —, pela regra
única de `lib/os/prazo-execucao.ts` (a mesma do Dashboard e do sino). A OS fica **posicionada** pela
data prevista (agenda) e **atrasa** pelo prazo: são coisas diferentes. Ver `docs/prazos-da-os.md`.

O atrasado precisa continuar óbvio: além da barra vermelha, a **hora** dele também fica vermelha. Nos
outros a hora é o texto normal.

Como era antes deste desenho: as mesmas 4 cores por status, mas pintando o cartão inteiro (fundo +
contorno), e a sigla do técnico num círculo com um de três tons escolhido pelo nome — era isso que dava
o efeito de mosaico.

### O que vai dentro do cartão

```
▍ 09:00  Hospital Santa Clara …        ⚠ ↻  AD
│ └hora  └cliente (o que sobra)        │ │  └ sigla do técnico: pequena, cinza
└ barra do status                      │ └ OS recorrente
                                       └ prioridade alta ou urgente
```

- **Hora** em destaque (semibold). **Cliente** no texto normal, com a largura que sobra.
- **Sigla do técnico** discreta: 9 px, cinza, sem círculo e sem cor. Atividade com equipe mostra `AD+2`;
  sem técnico, `—`. O nome completo está no `title` e no balão.
- **Ícones** só quando valem, sempre em tom neutro: alerta na prioridade alta/urgente, recorrência na OS
  recorrente. O cadeado da OS concluída saiu do cartão (a barra verde já diz; o aviso "não é possível
  reagendar" continua ao passar o mouse).
- O status vai também em texto para o leitor de tela (`sr-only`).

Contraste conferido em teste (`tests/unit/calendario-melhorias-ui.test.ts`): nome, hora e sigla sobre o
fundo do cartão ≥ 4.5:1 (WCAG AA); a barra sobre o cartão e sobre o branco do dia ≥ 3:1.

No celular cada dia mostra quantas OS tem (número em tom neutro) e um ponto por status presente.

A barra à esquerda é uma **exceção registrada** à regra "sem borda colorida à esquerda"
(`docs/design-system.md`): vale só para o evento do calendário.

O app interno tem só o tema claro hoje. As cores são classes dos tokens, sem hexadecimal solto: um
tema escuro, quando existir, troca os tokens e precisa repetir a conferência de contraste.

## Hoje

O círculo do dia atual pulsa de leve (`.anim-hoje-pulso`, um anel que se abre e some). Em
`prefers-reduced-motion: reduce` o pulso é desligado e o círculo continua.
