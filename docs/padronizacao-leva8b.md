# Padronização de telas — leva 8B (Financeiro: faturar e medições)

Segunda fatia da leva 8. Com a 8B o **corte da 8 fica em três**, como combinado (dividir mais se
pesasse):

| | Escopo | Estado |
|---|---|---|
| **8A** | o que mexe no caixa: índice, fluxo de caixa, ficha e formulários da conta a pagar, cobrança nova | no master |
| **8B** (este PR) | **faturar e medir**: ficha da medição e da fatura avulsa (`/financeiro/medicoes/[id]`, `/financeiro/faturas/[id]`), formulário (`/nova`, `/[id]/editar`) e faturamento de contratos | aqui |
| **8C** (próximo) | **custo de pessoal e fiscal**: `/financeiro/custo-pessoal`, `/colaborador/[id]`, `/importar`, `/financeiro/fiscal` e `/financeiro/notas-fiscais` | a fazer |

8C ficou junto porque sobrou pouco de cada lado (folha é um fluxo fechado, e o fiscal é quase todo
a central de notas, que já nasceu no padrão). Se preferir separar folha × fiscal, me diga.

**Não tem alteração de banco (🟢).** Nenhum arquivo em `prisma/sql/`, nenhuma mudança de schema.

## O achado: a ficha da medição não pedia permissão nenhuma

A lista (`/financeiro/medicoes`) já exigia **Financeiro › medições**. A **ficha**, a **criação** e a
**edição**, não: abriam para qualquer um que chegasse na rota. E dentro da ficha, `MedicaoAcoes`
desenhava o ciclo inteiro do faturamento sem olhar permissão.

No print `antes-medicao-sem-permissao.png`, quem tem só `financeiro.visualizar` vê e pode clicar:

> Reenviar / copiar link · **Registrar aprovação manual** · **Registrar pagamento** · Ver página do
> cliente · **Cancelar**

O servidor sempre recusou (a rota de ação exige `financeiro.medicoes`), então **nada de errado
chegou ao banco**. O problema era a tela oferecer o que não podia cumprir — e, em duas delas, abrir
uma porta que a lista já tinha fechado.

**Depois:** ficha, criação e edição barram na própria rota; cada ação do ciclo depende de
`financeiro.medicoes`; "Ver página do cliente" continua (é leitura).

## Prioridade nº 1 — faturar só para quem pode

| Onde | Ação | Permissão | Rota que recusa |
|---|---|---|---|
| ficha | enviar para aprovação (e-mail, WhatsApp, link) | Financeiro › medições | `POST /api/medicoes/[id]/acao` |
| ficha | registrar aprovação manual | Financeiro › medições | a mesma |
| ficha | registrar PC, NF e boleto | Financeiro › medições | a mesma |
| ficha | registrar pagamento | Financeiro › medições | a mesma |
| ficha | cancelar | Financeiro › medições | a mesma |
| `/medicoes/nova` e `/[id]/editar` | criar e editar medição | Financeiro › medições | `POST`/`PUT /api/medicoes` |

Provado em PostgreSQL real: as **sete ações** respondem 403 sem a permissão, e o banco fica
idêntico — mesmo status, mesmas datas de envio/aprovação/pagamento, mesma conta a receber. Sem
sessão, 401. A medição de uma empresa responde 404 para a outra.

**O menu também parou de levar a um beco:** "Medições" na barra lateral só aparece para quem tem a
permissão (o item apontava para uma tela que redirecionava).

## Faturamento é razão: cancelar não apaga

- a rota de ação **não tem** `DELETE`, `PUT` nem `PATCH`, e não há `medicao.delete` em lugar nenhum;
- cancelar marca `CANCELADA` e **devolve as contas a receber geradas ao estado previsto** (elas
  continuam existindo, com o valor do contrato de volta);
- com **parte do dinheiro já recebido** (ou perda/renegociação), o cancelamento é **recusado** (409)
  com o motivo: resolver antes no Contas a receber;
- quando a conta já está **RECEBIDA**, o recebimento **não é desfeito**: a medição cancela e a conta
  segue recebida, ligada a ela. Isso virou teste, porque é o ponto em que "desfazer" poderia comer
  dinheiro que entrou.

**O ciclo não mudou** — e também virou teste: a aprovação manual segue a regra do cliente (quem
**exige PC antes da NF** para em "aguardando PC"; quem não exige pula para "PC recebido"), e
registrar pagamento deixa a medição paga com data e forma.

## Tela a tela — o que existia × o que mudou

| Tela | Antes | Depois |
|---|---|---|
| `/financeiro/medicoes/[id]` | sem trava de permissão; ações sem permissão; sucesso em faixa verde na tela | trava na rota; ações por permissão; **toast** em cada ação, com a palavra certa (medição ou fatura); ⓘ no título com a regra do cancelamento |
| `/financeiro/faturas/[id]` | a mesma tela (reexport) | herda tudo: a fatura avulsa diz "fatura" nos avisos |
| `/financeiro/medicoes/nova` | qualquer um abria | trava na rota; ⓘ dizendo o que nasce aqui e o que nasce no "Faturar" da venda |
| `/financeiro/medicoes/[id]/editar` | só checava o status | trava na rota (além do status); ⓘ dizendo por que só rascunho se edita |
| `/financeiro/faturamento-contratos` | já tinha trava e toast | sem mudança (já estava no padrão) |
| barra lateral | "Medições" para quem só visualiza | só com Financeiro › medições |

A confirmação de cancelar passou a dizer o que acontece: _"Cancelar a medição MED-…? As contas a
receber geradas voltam a previsto."_

## Testes

| Arquivo | O que prova |
|---|---|
| `tests/unit/padronizacao-leva8b.test.ts` (13) | guardas de fonte: trava nas três telas, permissão em cada ação, leitura livre da página do cliente, toast por ação, erro na tela, nenhuma porta de exclusão, menu sem beco |
| `tests/unit/padronizacao-leva8b-pg.test.ts` (10) | PostgreSQL real: as 7 ações com 403 e **banco idêntico**, 401 sem sessão, 404 entre empresas, o ciclo (aprovação conforme o cliente, pagamento), cancelar que devolve a conta ao previsto, 409 com dinheiro recebido, recebimento que não se desfaz |
| `tests/unit/padronizacao-leva8b-ui.test.ts` (9) | num DOM de verdade: o que cada permissão vê, o passo de cada status, o toast com a palavra do documento, o erro que fica na tela sem atualizar, a confirmação de cancelar |

**Mutação: 12 mutantes, 12 pegos** — ações sem permissão (aprovar, cancelar, pagar), ação sem toast,
erro virando sucesso, telas sem trava, rota com guarda fraca, cancelamento ignorando o dinheiro
recebido, cancelar virando exclusão e cancelar deixando a conta presa à medição.

Nenhum teste antigo precisou de mudança de expectativa.

## Prints

`docs/prints/padronizacao-leva8b/` — 18 de "antes" e 22 de "depois": desktop e celular das seis
telas, o ⓘ da ficha aberto, o toast depois de registrar a aprovação (com a ficha já no passo
seguinte) e as telas vistas por quem **só visualiza** o financeiro.

## ❓ Uma decisão que vale conferir

Com a trava na ficha, quem tem só `financeiro.visualizar` **não vê mais a medição** — nem em
leitura. Segui a regra que a lista já aplicava (ela redireciona desde antes desta leva), e tirei o
item do menu para não virar beco sem saída.

Se você preferir que `visualizar` **veja a medição em leitura** (documento, retenções, contas
vinculadas) com os botões escondidos, é trocar a trava da ficha por um `podeMexer` já pronto no
componente — meia hora de trabalho. A 8A seguiu o mesmo critério (lá a lista de contas a pagar é
aberta a `visualizar`, e por isso a ficha também é).
