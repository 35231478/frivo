# Padronização de telas — leva 8A (Financeiro: pagar e receber)

**Primeira metade da leva 8.** O Financeiro é o módulo mais sensível do sistema, então o corte foi
por fluxo, como nas levas 7A/7B:

| | Escopo | Estado |
|---|---|---|
| **8A** (este PR) | o dia a dia do dinheiro: `/financeiro`, `/financeiro/fluxo-caixa`, a ficha da conta a pagar (`/financeiro/contas-pagar/[id]`), o formulário dela (`.../nova`, `.../[id]/editar`) e a cobrança nova (`/financeiro/contas-receber/nova`) | aqui |
| **8B** (próximo) | o que gera o dinheiro: faturas (`/financeiro/faturas/[id]`), faturamento de contratos, medições (`/[id]`, `/[id]/editar`, `/nova`), custo de pessoal (`/custo-pessoal`, `/colaborador/[id]`, `/importar`) e o fiscal (`/fiscal`, `/notas-fiscais`) | a fazer |

O corte é por fluxo e não por tamanho: 8A é **o que mexe no caixa** (pagar, cobrar, cancelar), 8B é
**o que fatura e apura** (medição, fatura, NFS-e, folha). Os dois lados usam os mesmos componentes
prontos — `TabelaPro`, `Dica` (ⓘ), toast e confirmação da casa, tokens `PLANILHA`,
`SeletorCadastro` com criar e editar no contexto.

**Não tem alteração de banco (🟢).** Nenhum arquivo em `prisma/sql/`, nenhuma mudança de schema.

## O achado que mandou na leva: botão de dinheiro sem permissão

`ContaPagarAcoes` — o componente que desenha as ações da conta a pagar **na ficha e no ⋮ da lista** —
não olhava permissão nenhuma. Quem tinha só `financeiro.visualizar` via, e podia clicar:

- **Registrar pagamento** (abre o diálogo e tenta lançar);
- **Editar** (abria `/financeiro/contas-pagar/[id]/editar`, que também não barrava);
- **Cancelar conta** — e aqui estava o pior: o código fazia `await fetch(..., DELETE)` e chamava
  `router.refresh()` **sem olhar a resposta**. Com 403 de volta, a tela recarregava como se tivesse
  dado certo, e a pessoa não via erro nenhum.

O servidor sempre recusou (as quatro rotas já exigiam `financeiro.fluxoCaixa` /
`financeiro.contasReceber`), então **nada de errado chegou ao banco** — o problema era a tela
prometer o que não podia cumprir. Está no print `antes-conta-pagar-sem-permissao.png`: os quatro
ícones aparecendo para quem só consulta.

Nesta leva: as três ações passam a depender de `financeiro.fluxoCaixa` (a mesma permissão da rota),
o cancelamento **lê a resposta antes de mexer na tela**, e as telas de formulário barram na própria
rota. "Ver detalhes" e "Histórico de pagamentos" continuam para quem só consulta — são leitura.

## Prioridade nº 1 — o que mexe em dinheiro, tela por tela

| Onde | Ação | Permissão | Rota que recusa |
|---|---|---|---|
| ficha e ⋮ da lista | registrar pagamento | Financeiro › fluxo de caixa | `POST /api/contas-pagar/[id]/pagamentos` |
| ficha e ⋮ da lista | editar conta | Financeiro › fluxo de caixa | `PUT /api/contas-pagar/[id]` |
| ficha e ⋮ da lista | cancelar conta | Financeiro › fluxo de caixa | `DELETE /api/contas-pagar/[id]` (cancela, não apaga) |
| lista e `/contas-pagar/nova` | criar conta a pagar | Financeiro › fluxo de caixa | `POST /api/contas-pagar` |
| `/contas-receber/nova` | criar cobrança | Financeiro › contas a receber | `POST /api/contas-receber` |

Provado em PostgreSQL real, com a requisição na mão: **403 e o banco idêntico ao que era** — mesmo
status, mesmo valor pago, mesmo saldo, mesma quantidade de pagamentos e de contas. Sem sessão, 401.
A conta de uma empresa responde 404 para a outra.

## Dinheiro é razão: cancelar não apaga

Igual ao razão do estoque (7A) e ao vínculo da nota (7B):

- a rota de cancelamento faz `update` de status para `CANCELADO` — **não existe** `contaPagar.delete`
  em rota nenhuma, e a rota de pagamentos não tem `DELETE`, `PUT` nem `PATCH`;
- o que já foi pago **continua registrado**: teste em PostgreSQL paga R$ 400, cancela, e confere que
  a conta segue existindo, com `valorPago` 400 e o pagamento no histórico;
- conta cancelada **não aceita pagamento novo** (400), e nada é lançado;
- a confirmação diz isso com todas as letras: _"A conta fica no histórico como cancelada; o que já
  foi pago não é desfeito."_

**A lógica do dinheiro não mudou** — e isso também virou teste: pagamento parcial desconta do saldo
e deixa a conta `PAGO_PARCIAL` pelo que falta; o pagamento que cobre o saldo deixa `PAGO_TOTAL` com
saldo zero. Esta leva mexeu na tela, não no cálculo.

## Tela a tela — o que existia × o que mudou

| Tela | Antes | Depois |
|---|---|---|
| `/financeiro` | sem ⓘ no título (os cards já tinham); "conta(s)" em três lugares | ⓘ no título; plural escrito |
| `/financeiro/fluxo-caixa` | sem ⓘ no título | ⓘ dizendo que é pela data em que o dinheiro se mexeu, não pelo vencimento |
| `/financeiro/contas-pagar/[id]` | sem ⓘ; ações sem permissão; cancelamento mudo no 403 | ⓘ com a regra do dinheiro; ações por permissão; 403 vira toast de erro e a tela não muda; valores do histórico nos tokens `PLANILHA` |
| `/financeiro/contas-pagar/nova` | qualquer um abria | barra na rota (Financeiro › fluxo de caixa); ⓘ dizendo quando a conta nasce aqui e quando vem da NF |
| `/financeiro/contas-pagar/[id]/editar` | qualquer um abria | barra na rota; ⓘ dizendo o que dá e o que não dá para mudar |
| `/financeiro/contas-receber/nova` | qualquer um abria | barra na rota (Financeiro › contas a receber); ⓘ |
| lista de contas a pagar | "Nova Conta" para todos, em caixa de título | "Nova conta" só com a permissão, em caixa de frase (não leva mais a um beco sem saída) |
| formulários (conta e cobrança) | sucesso só navegava; seletores sem o lápis | **toast** no sucesso; **editar no contexto** em fornecedor, categoria, centro de custo, conta bancária; valor alinhado pelos algarismos |

## Testes

| Arquivo | O que prova |
|---|---|
| `tests/unit/padronizacao-leva8a.test.ts` (17) | guardas de fonte: ⓘ nas seis telas, permissão nos botões e nas rotas das telas, cancelamento que lê a resposta, toast em toda gravação, nenhuma porta de exclusão, editar no contexto, tokens `PLANILHA` |
| `tests/unit/padronizacao-leva8a-pg.test.ts` (12) | PostgreSQL real: 401/403 com o **banco idêntico** antes e depois, 404 entre empresas, pagamento parcial e total, conta cancelada que não aceita pagamento, cancelar que preserva o histórico |
| `tests/unit/padronizacao-leva8a-ui.test.ts` (12) | num DOM de verdade: o que cada permissão vê na ficha e no ⋮, o 403 que **não** atualiza a tela, o toast com valor e saldo, o erro que fica na tela |

**Mutação: 10 mutantes, 10 pegos** — pagar/cancelar sem permissão, cancelamento ignorando a recusa,
pagamento sem toast, tela de criar sem trava, cobrança com a permissão errada, seletor sem o lápis,
cancelamento virando exclusão de verdade, rota de pagamento com guarda fraca, e conta cancelada
voltando a aceitar pagamento.

Nenhum teste antigo precisou de mudança de expectativa nesta leva.

## Prints

`docs/prints/padronizacao-leva8a/` — 21 de "antes" e 27 de "depois": desktop e celular das seis
telas, o ⓘ da ficha aberto, o diálogo de pagamento, o toast depois de pagar, e as telas vistas por
quem **só visualiza** o financeiro.

No print de "depois" sem permissão a ficha mostra **só o histórico** (`pagar: 0 · editar: 0 ·
cancelar: 0 · histórico: 1`, no log do Playwright), e `/nova`, `/editar` e `/contas-receber/nova`
terminam em `/sem-permissao`.

> Nota de print, não de produto: o ⋮ aberto da lista não sai em imagem porque `MenuAcoes` fecha em
> qualquer rolagem (`window.addEventListener("scroll", …, true)`) e o clique do Playwright rola a
> tabela. Quem prova o conteúdo do ⋮ por permissão é o teste de DOM.

## Fora de escopo, de propósito

- **A lógica de pagamento/baixa/emissão** não foi tocada: esta leva padroniza a tela.
- **A gaveta da conta a receber** (`conta-receber-detalhes`) já tinha permissão e toast das levas
  anteriores; só entrou aqui o formulário da cobrança nova, que era o que faltava.
- **Contas bancárias, fornecedores, encargos e as listas** continuam como estavam: já estão no padrão.
