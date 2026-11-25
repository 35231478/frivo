# Listas — a linha inteira abre, Status da OS por estágio, Prevista × Prazo

Três ajustes de usabilidade pedidos pelo dono, a partir da lista de Ordens de serviço. O primeiro
vale para TODAS as listas que usam a tabela profissional (`components/listagem/tabela-pro`).

## 1. A linha inteira abre o registro

Antes só o número (ou o nome) abria o registro; o resto da linha era "morto". Agora a tela dá o
`href` da linha (`LinhaPro.href`) e a tabela cuida do resto, em um lugar só:

| Gesto | O que acontece |
|---|---|
| clique em qualquer célula comum | abre o registro (roteador do Next, sem recarregar) |
| clique no checkbox da seleção, no botão de ações, no link do número, num campo, num rótulo | faz o que aquilo faz — **não** abre |
| clique no espaço vazio de uma coluna fixa (checkbox, ações) | não abre: aquela coluna é só controle |
| arrastou o mouse para copiar um texto e soltou | não abre (há texto selecionado na página) |
| Ctrl/⌘ + clique, Shift + clique, botão do meio | abre em **nova aba** |
| botão direito, Alt + clique | não abre (menu de contexto / baixar) |
| Tab até a linha e Enter | abre (Ctrl+Enter em nova aba); Enter num campo dentro da linha é do campo |

A linha com `href` ganha o cursor de link e o anel de foco (`PLANILHA.linhaAbre`); sem `href` fica
como era (quem não tem permissão de abrir não recebe o `href`: colaboradores só para quem gerencia,
admissões só para quem abre a ficha). O link do número/nome continua existindo, para o botão direito
"abrir em nova aba". A regra é pura e testada em `lib/listagem/abrir-linha.ts`
(`tests/unit/abrir-linha.test.ts`); o componente, em `tests/unit/tabela-linha-abre-ui.test.ts`.

Listas ligadas: OS, colaboradores, clientes, orçamentos, estoque, equipamentos, contratos, veículos,
PMOC, admissões, leads do site, pedidos de compra, contas a pagar, medições/faturas, notas de compra
e custo de pessoal. As que abrem uma gaveta (contas a receber, notas fiscais) ficam como estão.

## 2. Status da OS = o estágio

A coluna Status da lista mostrava o status **gravado** (Aberta, Aguardando Atendimento, Pausada,
Aguardando Peça…), com classes próprias, e ficava longe à direita, depois de uma coluna Prazo de
284px. Agora mostra o **estágio** — o mesmo da barra de andamento da OS e das cores do calendário:
Aberta › Agendada › Em execução › Concluída › Faturada, ou Cancelada (`resumoStatus` em
`lib/os/status.ts`, com `statusManual`, atividades e medições, como a central da OS). O selo é o
`StatusPill` com `TOM_ESTAGIO_OS`. A coluna vem logo depois do cliente, visível por padrão, e
continua configurável em Colunas.

Ao lado do estágio mora o que pede ação: **Atrasada X dias** (vermelho) ou **Vence hoje** (atenção),
e **Justificado** quando o atraso foi justificado (o motivo no título). Os cartões (celular e visão
"cards") usam o mesmo selo. O filtro de status continua pelo status gravado (é o que o banco tem).

## 3. Prevista × Prazo

O que cada uma é (`lib/os/prazo-execucao.ts`):

- **Prevista** (`previsaoConclusao`) é agenda: o dia marcado para o serviço. Posiciona a OS no
  calendário e é o que o arrasto muda.
- **Prazo** (`prazoExecucao`) é compromisso: até quando a OS precisa estar concluída. É por ele que
  a OS fica "atrasada". A regra única é: OS **sem prazo próprio vale o dia previsto**.

Por isso as duas colunas mostravam quase sempre a mesma data (no banco de prints, 23 de 25 linhas):
a coluna Prazo repetia a prevista sem dizer que era herdada. Decisão:

- **Prevista** continua por padrão.
- **Prazo** fica **escondida por padrão** (liga em Colunas, com 96px, não 284). Ligada, mostra o prazo
  **próprio** em preto; quando a OS não tem um, mostra a data prevista **apagada** com o título
  "Sem prazo próprio: vale a data prevista" — nunca duas colunas iguais sem explicação.
- O selo de atraso saiu da coluna Prazo e foi para o Status: esconder a coluna não esconde o aviso.
- Nos cartões, a linha "Prazo dd/mm" só aparece quando o prazo é próprio.

Testes em `tests/unit/ordens-lista-barra-ui.test.ts`; prints em `docs/prints/os-lista-antes/` e
`docs/prints/os-lista/`.
