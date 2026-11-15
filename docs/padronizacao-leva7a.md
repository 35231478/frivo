# Padronização de telas — leva 7A (Estoque: o que mexe em saldo)

**As seis telas de estoque que mexem em saldo:** a lista de saldos, o extrato do produto, a fila "A
separar" e a de uma OS, a fila "A devolver" e a de uma OS. Reusa o que as levas 1 a 6 deixaram pronto
(`TabelaPro` e os componentes de lista, `Dica`, toast e confirmação da casa, os tokens `PLANILHA`) —
nada paralelo.

**Não tem alteração de banco (🟢).** Nenhum arquivo em `prisma/sql/`, nenhuma mudança de schema.

A leva 7 foi dividida por fluxo, como combinado: **7A é o estoque que mexe em saldo** (este PR) e
**7B é comprar** — notas de compra (`/estoque/notas`) e pedidos (`/compras/pedidos`), que são um
fluxo só: a nota nasce do pedido e alimenta estoque e conta a pagar.

## O cuidado que mandou no desenho: movimento de estoque é razão

O saldo do produto é o **cache da soma dos movimentos**. Por isso, nesta leva:

- **não criei nenhum "excluir movimento"** — nem botão, nem rota. A rota de movimentações só tem
  `POST`; não há `DELETE`, `PUT` nem `PATCH`, e há teste que falha se algum aparecer;
- **corrigir é lançar** — "Ajuste" (o saldo passa a ser o informado) ou "Inventário" (a contagem
  física vira a diferença). Os dois entram como **movimento novo**: o anterior continua lá, com o
  saldo que tinha na época, e o extrato mostra os dois, com quem fez e quando. Isso virou teste em
  PostgreSQL real: depois de uma entrada de 10 e um ajuste para 7, são duas linhas (10 e −3), e a
  primeira não foi tocada;
- **o ⓘ das duas telas conta essa regra** em uma frase, no lugar onde a dúvida aparece.

## Prioridade nº 1 — o que grava só aparece para quem pode

| Onde | Ação | Permissão | O que o servidor exige |
|---|---|---|---|
| `/estoque` e `/estoque/[produtoId]` | "Lançar" (entrada, saída, ajuste, inventário) | Estoque › gerenciar | `POST /api/estoque/[id]/movimentacoes` |
| `/estoque/[produtoId]` | preço de venda | Estoque › gerenciar | `PUT /api/estoque/[id]/preco` |
| `/estoque/separacao` e `/estoque/separacao/[osId]` | separar, desfazer | Estoque › separar | `POST /api/ordens/[id]/separacao` |
| `/estoque/devolucao` e `/estoque/devolucao/[osId]` | devolver, desfazer | Estoque › separar | `POST /api/ordens/[id]/devolucao` |

As quatro telas já checavam permissão antes de abrir. O que esta leva acrescenta é a prova do outro
lado, em teste: **com a requisição na mão e o 403 de volta, o banco não muda e a tela não muda** —
nem saldo, nem quantidade separada, nem situação do material; o motivo aparece onde a pessoa está
olhando, e nenhuma confirmação de sucesso é dada.

Um detalhe de honestidade que entrou junto: o botão do topo de `/estoque` dizia **"Importar NF de
compra"** para todo mundo. Quem não tem Estoque › gerenciar não importa nada; agora o botão diz
"Notas de compra" e deixa de se vestir de ação principal para essa pessoa.

## As telas, uma a uma

### `/estoque` — saldos

- **ⓘ no título** com a regra do razão e o que os destaques significam.
- O botão de NF por permissão (acima).
- O resto já estava no padrão desde a E1 (TabelaPro com colunas escolhíveis, cartões no celular,
  busca e filtros na barra da casa, aviso de "no mínimo" e "negativo" clicável).

### `/estoque/[produtoId]` — extrato

- **ⓘ no título**: cada movimento com quantidade com sinal e o saldo depois dele; não se apaga nem se
  edita; corrigir é ajuste ou inventário.
- **O preço de venda confirma por toast** (era uma linha de "ok" dentro do painel). A tela continua
  com o erro de validação, que é o padrão da casa.

### `/estoque/separacao` e `/estoque/devolucao` — as duas filas

- A **tabela própria saiu** nas duas: viraram `TabelaPro` (`tabela:estoque-separacao` e
  `tabela:estoque-devolucao`), com colunas escolhíveis e larguras por usuário, e os cartões de
  celular que já existiam passaram a entrar por `cartoes`.
- Lista vazia no componente da casa.
- ⓘ, toast e a confirmação já estavam certos (vieram prontos na E4).

### `/estoque/separacao/[osId]` — separar material

- A tabela de trabalho (uma linha por material, com o campo "separar agora") passou a usar os
  **tokens `PLANILHA`** — a mesma régua da prévia da recorrência do contrato (leva 6A): **listagem é
  `TabelaPro`; planilha dentro de formulário é `PLANILHA`**.
- O resto já estava certo: só grava depois do ok do servidor, confirma quando o saldo não cobre,
  toast no fim, "Desfazer" com confirmação de perigo.

### `/estoque/devolucao/[osId]` — devolver material

Nada a mudar: já usava os componentes da casa, já só mexia na tela depois do ok do servidor. Entrou
na leva como guarda de teste (para continuar assim).

### O lançamento de movimento (as duas telas usam)

- **Sucesso virou toast da casa**: "Entrada lançada. Saldo agora: 14 un." — com a operação por extenso
  (entrada, saída, ajuste, inventário).
- O modal **continua aberto** com o saldo novo, o aviso de saldo negativo (que não pode sumir
  sozinho) e o "Lançar outro" — o fluxo de quem lança vários não foi encurtado.

## Testes

| Arquivo | O que cobre |
|---|---|
| `tests/unit/padronizacao-leva7a.test.ts` | guardas de fonte: ⓘ das duas telas (e o que o texto promete), filas na tabela da casa sem `<table>` à mão, planilha nos tokens, toast em toda gravação, a rota sem DELETE/PUT, nenhuma tela com "excluir movimento", e o "só grava depois do ok" |
| `tests/unit/padronizacao-leva7a-pg.test.ts` | as rotas num PostgreSQL real: lançar (403 sem gerenciar, nada no razão), ajuste e inventário como movimento novo com o anterior intacto, separar e devolver (403 com material e saldo intactos; com a permissão, a reserva entra no razão), produto e OS de outra empresa |
| `tests/unit/padronizacao-leva7a-ui.test.ts` | as telas montadas: o toast com operação e saldo; **403 não muda nada na tela** (lançamento e separação), e a planilha com os tokens da casa |

**Mutação: 25 mutantes, todos pegos.** Um por regra desta leva — cada ⓘ (e o que ele promete), cada
fila na tabela da casa, a planilha, cada toast, cada permissão de rota e o "só grava depois do ok".

**Dois testes antigos mudaram de expectativa** (mudança intencional): `estoque-ui` e
`estoque-e2-ajuste-ui` esperavam a confirmação **dentro** do modal e do painel; agora esperam o
**toast da casa** (e o painel sem a linha repetida).

## Decisões que ficaram

- **Nenhum "excluir movimento", nem com confirmação.** Apagar linha de razão corrompe o saldo e o
  histórico. Ajuste e inventário resolvem o caso real (contei errado, quebrou, sumiu) deixando rastro.
- **O toast não substituiu o painel do modal.** O painel carrega o aviso de saldo negativo e o
  "Lançar outro"; o toast confirma no lugar de sempre. Um não é cópia do outro.
- **A planilha da separação não virou `TabelaPro`.** Ela tem campo editável por linha: é formulário,
  não listagem — a mesma linha traçada na leva 6A.
