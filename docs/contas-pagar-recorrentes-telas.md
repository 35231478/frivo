# Contas a pagar recorrentes — parte 2: as telas

A parte 1 (`docs/contas-pagar-recorrentes.md`) pôs a máquina embaixo: a regra, a geração com trava,
o horizonte no cron, pausar/encerrar/pular e a edição com escopo. Esta parte é a **cara** disso: onde
a pessoa cria, vê e mexe na despesa que se repete.

---

## Telas tocadas

| Tela | O que era | O que é agora |
| --- | --- | --- |
| **Nova conta a pagar** (`/financeiro/contas-pagar/nova`) | fornecedor, descrição, valor, vencimento, boleto | ganhou a seção **Repetição** com o toggle "Repetir (recorrente)". Ligado, abre a regra (frequência, dia do vencimento, fim de semana, início, término, valor a confirmar), troca "Valor total" por **"Valor de cada ocorrência"** e esconde o que é de uma conta só (vencimento avulso, banco, pedido de compra, boleto). O favorecido passa a ser **fornecedor ou colaborador** |
| **Editar conta a pagar** (`.../[id]/editar`) | formulário igual para toda conta | numa conta que veio de uma regra, abre o bloco **"Esta conta é de uma despesa recorrente"** com o alcance: *Só esta ocorrência* (padrão) × *Esta e as próximas em aberto*, cada um com a sua explicação. Com pagamento registrado não há escolha: a tela diz que o ajuste vale só para aquele mês |
| **Contas a pagar** (lista) | sem sinal de recorrência | marca **recorrente** (link para a regra) ao lado da origem NF/Pedido, na coluna Descrição, e **a confirmar** embaixo do valor; as duas também no cartão do celular; botão **Despesas recorrentes** no topo; filtro **Origem → Despesa recorrente** (e "Manual" passou a excluir as recorrentes) |
| **Conta a pagar** (detalhe) | — | os dois selos ao lado do status (onde há espaço), a linha **Despesa recorrente** (frequência, dia e competência) nos dados, e **Tornar recorrente** nas ações de uma conta avulsa |
| **Despesas recorrentes** (nova, `/financeiro/contas-pagar/recorrentes`) | não existia | a lista das **regras** na TabelaPro (descrição, favorecido, repetição, próxima, término, categoria, contas, situação, valor), cartões no celular, faixa com "N ativas · N pausadas · Em aberto já gerado: R$ X", ⓘ do módulo, e por regra: ver ocorrências, editar, gerar o que falta, pausar/retomar, encerrar |

Prints (desktop e celular) em `docs/prints/contas-pagar-recorrentes/`, `antes-*` e `depois-*`.
A tela de regras não tem "antes": `antes-recorrentes*.png` é o 404 de hoje, de propósito — é a prova
de que a rota não existia.

---

## Padrão da casa

- **Listagem é TabelaPro**: a tela nova usa o mesmo componente das outras listas (colunas
  redimensionáveis, menu "Colunas", preferência por usuário). Como a `barra` da TabelaPro é só do
  desktop, os números aparecem **também** no topo da lista de cartões do celular — a mesma
  informação nas duas versões (tem teste e mutação para isso).
- **Sucesso é toast; erro fica na tela.** Criar a regra, pausar, encerrar, gerar e pular avisam por
  toast, dizendo o número: *"Despesa pausada. 2 ocorrências futuras canceladas."* O erro de
  validação do formulário fica no formulário, onde a pessoa está olhando.
- **Instrução no ⓘ**, não solta na tela: o que é despesa recorrente, o que o término "sem data"
  significa, e por que conta paga não muda.
- **Confirmação da casa** em encerrar e em pular, com o que acontece dito antes: *"A regra para de
  gerar e as ocorrências futuras ainda em aberto são canceladas. O histórico fica."*
- **Plural escrito**: "1 ocorrência futura cancelada" × "2 ocorrências futuras canceladas".
- **Permissão nos botões**: quem só tem `Financeiro › visualizar` abre a tela e vê tudo, mas não vê
  nenhuma ação de dinheiro — nem "Nova despesa recorrente", nem pausar, encerrar, editar, gerar ou
  pular. O servidor recusa igual (403), e **a tela não muda** quando ele recusa: o motivo vem em
  toast de erro e a regra continua como estava.

## Dinheiro é razão (na tela também)

- **Conta paga não muda**: na edição ela não ganha a escolha de alcance; nas ocorrências ela nem
  oferece o botão de pular — mostra "não muda", com o motivo no `title`.
- **Tornar recorrente não recria nada**: o diálogo diz, antes de confirmar, que a conta continua com
  o mesmo número, os mesmos pagamentos e o mesmo histórico, e passa a ser a primeira ocorrência.
- **Encerrar é encerrar, não apagar**: o texto da confirmação diz isso, e a regra encerrada continua
  na lista, com a situação e o motivo.
- O valor é o de **cada** ocorrência: a dica ao lado do campo diz "não multiplica".

---

## Decisões tomadas

- **Sem item novo na barra lateral.** A tela de regras entra por um botão no topo de Contas a pagar
  (e pelo selo "recorrente" de qualquer conta gerada). O menu da esquerda já está cheio; a despesa
  recorrente é parte de Contas a pagar, não um módulo à parte.
- **O toggle só existe na conta NOVA.** Uma conta que já existe vira recorrente pela ficha dela
  ("Tornar recorrente"), que é o caminho que preserva número, pagamentos e histórico.
- **O boleto fica fora da regra.** Boleto é de uma conta: cada ocorrência cola o seu quando chega.
  (O boleto automático por ocorrência está na Fase 2 da parte 1.)
- **"Manual" no filtro Origem passou a excluir as recorrentes.** Antes de existirem regras, "Manual"
  significava "sem nota e sem pedido"; agora a conta de uma regra não é manual.
- **Os selos não viraram pílula na coluna Situação.** A primeira versão colocou "recorrente" e
  "a confirmar" ali, e o print mostrou o estrago: a coluna é estreita e as pílulas escreviam por
  cima do valor. "recorrente" é **origem** (foi para a Descrição, junto do NF/Pedido, no mesmo
  formato discreto) e "a confirmar" qualifica o **valor** (foi para baixo do número, onde o
  "falta X" já mora).
- **A tela de regras mostra 6 colunas por padrão** (~1040px, cabem numa tela de 1440 com a barra
  lateral aberta). Com as 10 que ela tinha no primeiro desenho, Valor e Ações saíam da tela.
  Termina, Categoria, Centro de custo e Contas ficam no menu "Colunas".
- **Os campos da regra são um bloco só** (`components/financeiro/campos-recorrencia.tsx`), usado nos
  três lugares que mexem nela: o toggle da conta nova, "Tornar recorrente" e a edição da regra. A
  validação é a **mesma** do servidor (`validarRegra`), então a tela nunca pede o que a rota recusa.

## Testes

| Arquivo | Testes | O que prova |
| --- | --- | --- |
| `tests/unit/conta-pagar-recorrentes-telas.test.ts` | 11 | as regras puras do formulário (início sugerido, término que manda só os campos dele, ida e volta de uma regra existente, a validação da rota recusando o que está errado) e as guardas: permissão em cada rota e em cada ação da tela, filtro no servidor, cron |
| `tests/unit/conta-pagar-recorrentes-ui.test.ts` | 21 | num DOM de verdade: o toggle desligado não muda nada; ligado cria a REGRA; favorecido colaborador; o alcance na edição (e a ausência dele na conta paga); a tela de regras no desktop e no celular; quem só visualiza; a recusa do servidor que não muda a tela; a confirmação da casa; pular; tornar recorrente |

**Rodada de mutação: 18 de 18 pegas** (15 na primeira rodada + 3 nos defeitos que os prints acharam) — o toggle decorativo, o alcance que não vai (ou que vai numa
conta paga), o término mandando os dois campos, a frequência nomeada usando o passo digitado, o
início que ignora o dia que já passou, a ação sem permissão na tela, a recusa do servidor mudando a
tela, encerrar sem confirmação, a conta paga voltando a oferecer pular, os números saindo do celular,
"tornar recorrente" numa conta que já é de uma regra, o filtro "Manual" voltando a incluir as
recorrentes, a tela sem permissão para abrir e a rota de tornar recorrente aceitando quem só vê —
mais o selo voltando a ser link dentro do cartão (âncora dentro de âncora), o selo do desktop
deixando de levar para a regra e o cartão do celular deixando de abrir as ocorrências.

## O que os prints pegaram (e os testes não)

Três defeitos reais só apareceram no navegador de verdade:

1. **Âncora dentro de âncora**: o selo "recorrente" era um link dentro do link do cartão do celular.
   `<a>` dentro de `<a>` é HTML inválido; o navegador reorganiza a árvore e a **hidratação do React
   quebrava** na lista de contas a pagar. Hoje o selo do cartão é texto, e só o do desktop é link.
2. **Selos estourando a coluna Situação**, escrevendo por cima do valor (acima).
3. **A tela de regras passando da largura**, empurrando Valor e Ações para fora (acima).

Os três viraram teste e entraram na rodada de mutação.
