# Padronização de telas — leva 7B (Comprar: notas de compra e pedidos)

**As cinco telas do fluxo de compra:** a lista de notas (`/estoque/notas`), a central de lançamento
de uma nota (`/estoque/notas/[id]`), a lista de pedidos (`/compras/pedidos`), o pedido
(`/compras/pedidos/[id]`) e o novo pedido avulso (`/compras/pedidos/novo`). Reusa o que as levas 1 a
7A deixaram pronto (`TabelaPro` e os componentes de lista, `Dica`, toast e confirmação da casa, os
tokens `PLANILHA`, o `SeletorCadastro` com criar e editar no contexto) — nada paralelo.

**Não tem alteração de banco (🟢).** Nenhum arquivo novo em `prisma/sql/`, nenhuma mudança de
schema. Tudo o que a sugestão precisa já estava gravado: saldo e estoque mínimo do produto, itens de
nota e movimentações de entrada.

Com esta leva a **leva 7 fecha**: 7A foi o estoque que mexe em saldo, 7B é comprar.

## O cuidado que mandou no desenho: o vínculo nota ↔ estoque ↔ conta a pagar

Lançar uma nota faz **duas coisas de uma vez, na mesma transação**: a entrada no estoque (razão,
com a nota como referência) e as contas a pagar (uma por parcela, também apontando para a nota). Por
isso, nesta leva:

- **não criei nenhum "excluir nota lançada"** — nem botão, nem rota. As rotas de nota e de
  lançamento só têm `POST`; o único `DELETE` do fluxo desfaz o **vínculo com o pedido de compra**
  (reversível, e vai para o histórico do pedido);
- **nota lançada não muda mais de vínculo**: o rascunho da conciliação fecha com 409 ("os vínculos
  não mudam mais"), e lançar duas vezes é 409 — o estoque e as contas não dobram. Isso virou teste
  em PostgreSQL real;
- **corrigir é estorno/ajuste**, como no razão da 7A: pela conta a pagar, no Financeiro, e por
  ajuste de estoque, que entra como movimento novo;
- **o ⓘ das duas telas de nota conta essa regra** em uma frase, no lugar onde a dúvida aparece.

## Prioridade nº 1 — o que grava só aparece para quem pode

| Onde | Ação | Permissão | O que o servidor exige |
|---|---|---|---|
| `/estoque/notas` | importar XML da NF-e | Estoque › gerenciar | `POST /api/compras/notas` |
| `/estoque/notas/[id]` | salvar rascunho da conciliação | Estoque › gerenciar | `PUT /api/compras/notas/[id]/conciliacao` |
| `/estoque/notas/[id]` | confirmar e lançar | Estoque › gerenciar **e** Financeiro › fluxo de caixa | `POST /api/compras/notas/[id]/lancar` |
| `/estoque/notas/[id]` | preço de venda na linha | Configurações › gerenciar | o mesmo `lancar` (recusa o preço sem a permissão) |
| `/estoque/notas/[id]` e `/compras/pedidos/[id]` | vincular / desvincular a nota do pedido | Compras › gerenciar | `POST` e `DELETE /api/compras/notas/[id]/vinculos` |
| `/compras/pedidos` e `/compras/pedidos/novo` | novo pedido avulso | Compras › gerenciar | `POST /api/pedidos-compra` |
| `/compras/pedidos/novo` | sugestão do estoque | Compras › gerenciar | `GET /api/compras/sugestoes` |
| `/compras/pedidos/[id]` | editar, cancelar | quem edita o pedido (Compras › gerenciar, comprador ou dono da origem) | `PUT /api/pedidos-compra/[id]`, `POST .../cancelar` |
| `/compras/pedidos/[id]` | baixar PDF, e-mail, WhatsApp | quem envia o pedido | `POST /api/pedidos-compra/[id]/enviar` |

As cinco telas **já checavam permissão antes de abrir e já escondiam cada botão** — isso veio das
levas anteriores e do próprio módulo de compras. O que esta leva acrescenta é a prova do outro lado,
em teste: **com a requisição na mão e o 403 de volta, o banco não muda** (nota nenhuma entra, nada
vai para o estoque nem para o financeiro, a nota continua `IMPORTADA`), e **nada atravessa de outra
empresa** (a nota da empresa A responde 404 para a empresa B).

O 403 de lançar sem Financeiro diz o motivo em vez de repetir "sem permissão":
_"Lançar a nota gera conta a pagar: precisa também de Financeiro › fluxo de caixa."_

## Tela a tela — o que existia × o que mudou

| Tela | Antes | Depois |
|---|---|---|
| `/estoque/notas` | tabela própria no desktop + lista de cartões escrita à mão; vazio em texto solto | `TabelaProUrl` (colunas escolhíveis, densidade da casa, cartões no celular) e `ListaVazia`; ⓘ no título contando o vínculo com estoque e conta a pagar |
| `/estoque/notas/[id]` | sem ⓘ; sucesso do rascunho e do lançamento em texto verde na própria tela | ⓘ no título; **sucesso agora é toast** ("Rascunho salvo. Faltam 3 itens sem produto." / "Nota lançada: entrada no estoque e conta a pagar criadas."); erro de validação continua na tela; código do item nos tokens `PLANILHA`; "entrada(s)/conta(s)" viraram plural escrito |
| `/compras/pedidos` | tabela própria + cartões à mão; sem ⓘ | `TabelaProUrl` com Comprador como coluna oculta por padrão; ⓘ no título com o ciclo e onde a NF entra |
| `/compras/pedidos/[id]` | sem ⓘ | ⓘ no `PageHeader` (ciclo, histórico, e que a NF entra por Estoque › Notas de compra) |
| `/compras/pedidos/novo` | sem ⓘ; seletores de produto e fornecedor sem o lápis de editar no contexto; sem sugestão | ⓘ; **editar no contexto** nos dois seletores (o cadastro rápido "+ Novo…" já existia); **faixa de sugestão do estoque**; quantidade e valor estimado alinhados pelos algarismos (`PLANILHA.numero`) |
| `ImportarNota` (nas duas telas) | sucesso só navegava para a nota | navega **e** dá o toast: "NF 10482/1 importada: 1 de 3 itens já com produto." |

## A sugestão do novo pedido de compra (Princípio 9)

`lib/compras/sugestao-compra.ts` (regras puras) + `lib/compras/sugestao-compra-server.ts` (duas
consultas) + `GET /api/compras/sugestoes` + `components/compras/sugestoes-compra.tsx` (a faixa).

**São duas fontes com duas regras, e isso é de propósito:**

- **quais produtos** — fato do estoque: saldo **no mínimo ou abaixo** (a mesma conta da tela de
  Estoque, `situacaoEstoque`, que já trata saldo negativo). Entra **mesmo sem histórico**, porque a
  falta é um fato, não um palpite. A faixa mostra quanto falta para voltar ao mínimo;
- **fornecedor e preço** — vêm do histórico e seguem a **regra da casa**, irmã das sugestões da OS
  (leva 5) e do item do orçamento (6B): janela de **6 meses**, no mínimo **2 compras distintas**, e o
  preço é o da **compra mais recente, nunca a média**. Sem isso, o produto aparece como **"compra
  nova"**, sem preço.

> **Decisão que vale conferir, Zé:** li "senão não sugere" como **não sugerir o preço**, não como
> esconder o produto. O argumento: o produto no mínimo é informação que o sistema tem com certeza, e
> escondê-lo por falta de histórico seria esconder justamente a compra nova — que é a que mais
> precisa de atenção. Se você preferir o outro corte (histórico fino → o produto nem aparece), é uma
> linha em `sugestoesDeCompra` e um teste; me diga.

Detalhes que a regra cuida: **duas linhas da mesma nota contam como UMA compra** (a nota é o
documento); entrada de compra lançada à mão (sem NF) também é histórico, mas sem fornecedor;
**entrada que não é compra** (ajuste, devolução) nunca vira histórico de preço; a faixa mostra no
máximo 6 sugestões, da mais crítica (saldo negativo) para a menos.

**Sugere, não preenche no escuro:** nada é adicionado sozinho. Clicar coloca a linha no pedido com a
quantidade que falta e o último preço — tudo editável, e o produto some da faixa. "Dispensar" tira a
faixa. Se a rota responder 403 (sem Compras › gerenciar) ou falhar, a faixa simplesmente não
aparece e o pedido continua funcionando. A faixa só é buscada no **pedido avulso novo**: editar um
pedido, ou um pedido de OS/orçamento, nem chama a rota.

## Testes

| Arquivo | O que prova |
|---|---|
| `tests/unit/padronizacao-leva7b-sugestao.test.ts` (12) | as regras puras: janela de 6 meses, mínimo de 2 compras, último preço e não a média, histórico fino sem preço, mesma nota = uma compra, quanto falta (inclusive saldo negativo), ordem por criticidade, teto da faixa |
| `tests/unit/padronizacao-leva7b.test.ts` (29) | guardas de fonte: ⓘ nas cinco telas, listas na `TabelaPro` sem `<table>` à mão, formulário nos tokens `PLANILHA`, botão sensível por permissão, guarda em cada rota, toast no sucesso, nenhuma porta de saída para a nota lançada, a faixa só no avulso, editar no contexto nos seletores |
| `tests/unit/padronizacao-leva7b-pg.test.ts` (19) | PostgreSQL real: os 401/403 com o banco intacto, 404 entre empresas, o vínculo nota↔estoque↔conta a pagar na mesma transação, 409 ao lançar de novo, e a sugestão lendo estoque e histórico de verdade |
| `tests/unit/padronizacao-leva7b-ui.test.ts` (10) | a faixa num DOM de verdade: o que ela diz, o clique que vira linha editável, "compra nova" sem preço, "Dispensar", 403 e erro de rede sem atrapalhar o pedido |

**Expectativas de teste atualizadas (mudanças intencionais, não máscara)** — quatro testes antigos
descreviam o comportamento que esta leva mudou de propósito:

| Teste | O que checava | Por que mudou |
|---|---|---|
| `nota-compra-ui.test.ts` | o texto de sucesso **dentro da tela** (`role="status"`) no upload, no rascunho e no lançamento | o sucesso virou **toast da casa**; agora checa o toast e confere que o **erro** continua na tela |
| `estoque-e21-ui.test.ts` | "Rascunho salvo. Faltam 1 item(ns) sem produto." na tela | mesmo motivo, mais o plural escrito: "Falta 1 item" |
| `leva-estoque-e2.test.ts` | "Falta escolher o produto de 2 item(ns)" e "3 entrada(s) … 3 conta(s)" | plural escrito, nas duas frases |
| `compras-pedido-pg.test.ts` | a linha da lista de pedidos na tabela própria | a lista virou `TabelaPro`: `data-linha` passou para o `<tr>` e "Comprador" é coluna oculta por padrão |

Cada um está explicado no ponto onde foi alterado.

**Mutação (14 mutantes, 14 pegos):** aceitar histórico de 1 compra; preço virando o mais antigo;
ignorar a janela (nos dois caminhos: movimentação e item de NF); aceitar entrada que não é compra;
sugerir produto inativo; ignorar a situação do estoque; trocar a permissão da rota de sugestões;
pedir sugestão ao editar; quantidade fixa em 1; tirar o `editavel` do seletor de fornecedor; tirar o
toast do importar; mostrar o botão de importar sem permissão.

## Prints

`docs/prints/padronizacao-leva7b/` — 15 de "antes" e 21 de "depois" (desktop e celular das cinco
telas, a faixa de sugestão, a linha já preenchida pela sugestão, o toast do rascunho e as cinco
telas vistas por quem **só visualiza**).

Nos prints "sem permissão" (usuário com Estoque e Compras só em *visualizar*): a lista de notas não
mostra o campo de importar XML, a lista de pedidos não mostra "Novo pedido avulso", a nota mostra o
botão de lançar travado com o motivo, e `/compras/pedidos/novo` redireciona para `/sem-permissao`.

> Detalhe dos prints, não do código: no breadcrumb da nota aparece "L7b-n1" porque o id da massa de
> teste é falado (`l7b-n1`). Com id de verdade (cuid) o breadcrumb mostra "Detalhes", como nas
> outras telas.

## Fora de escopo (de propósito)

- **Aprovar/receber pedido** não virou botão novo: no fluxo atual o pedido anda por "enviar ao
  fornecedor" (Solicitado → Em cotação) e pelo lançamento da NF vinculada (→ Parcial/Concluído).
  Inventar um "aprovar" seria escopo novo, não padronização.
- **Conciliação em `TabelaPro`**: ela é formulário (planilha de trabalho), não listagem — fica nos
  tokens `PLANILHA`, como a separação da 7A.
- Os dois documentos citados no pedido (`captura-nf-compra-entrada-estoque-conta-pagar.md` e
  `modulo-compras-pedido-nf-conciliacao.md`) **não estão no repositório**. Usei como fonte da verdade
  o código (`lib/compras/notas.ts`, `lib/compras/conciliacao*.ts`), o SQL já aplicado
  (`prisma/sql/2026-11-03_compras_conciliacao_nf.sql`) e os testes de conciliação que já existiam.
