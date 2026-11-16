# Contas a pagar recorrentes — parte 2: a repetição dentro da conta

A parte 1 (`docs/contas-pagar-recorrentes.md`) pôs a máquina embaixo: a regra, a geração com trava,
o horizonte no cron, pausar/encerrar/pular e a edição com escopo. Esta parte é a **cara** disso.

**O desenho mudou no meio do caminho.** A primeira versão tinha uma tela à parte, "Despesas
recorrentes", com a lista das regras. Não é isso: a repetição é uma **propriedade do lançamento**,
não um cadastro paralelo. Hoje não existe tela de regras — tudo acontece **dentro da conta**: liga
ali, configura ali, vê a prévia ali, cancela ali.

---

## Telas tocadas

| Tela | O que era | O que é agora |
| --- | --- | --- |
| **Nova conta a pagar** (`/financeiro/contas-pagar/nova`) | fornecedor, descrição, valor, vencimento, boleto | ganhou o toggle **"Repetir lançamento?"**. Ligado, abre **Configurações de repetição** (um seletor com os atalhos de sempre + "Personalizar…"), a **Condição de pagamento** da repetição ("Cobrar sempre no" + "1º vencimento" + fim de semana), o "valor a confirmar" e a prévia **Recorrências previstas**. Troca "Valor total" por **"Valor de cada ocorrência"** e esconde o que é de uma conta só (vencimento avulso, banco, pedido de compra, boleto). O favorecido passa a ser **fornecedor ou colaborador** |
| **Conta a pagar** (detalhe) | — | **Repetir lançamento** nas ações de uma conta avulsa: abre o mesmo bloco de configuração e a conta passa a ser a primeira ocorrência (sem recriar nada). Numa conta que já se repete, a linha **Repetição** nos dados (intervalo, dia e competência) e o selo *recorrente* — texto, não link: não há tela para onde ir |
| **Editar conta a pagar** (`.../[id]/editar`) | formulário igual para toda conta | numa conta que veio de uma repetição, abre o bloco **"Esta conta é de uma despesa recorrente"** com o alcance: *Só esta ocorrência* (padrão) × *Esta e as próximas em aberto*. Com pagamento registrado não há escolha: a tela diz que o ajuste vale só para aquele mês |
| **Cancelar conta** (ação) | confirmação da casa, "tem certeza" | numa conta repetida a pergunta não é se, é **até onde**: *Só esta ocorrência* (a repetição continua) × *Esta e as próximas em aberto* (encerra a repetição). Em nenhum dos dois alguma conta é apagada |
| **Contas a pagar** (lista) | sem sinal de repetição | marca **recorrente** ao lado da origem NF/Pedido, na coluna Descrição, e **a confirmar** embaixo do valor; as duas também no cartão do celular; filtro **Origem → Despesa recorrente** (e "Manual" passou a excluir as recorrentes) |
| ~~**Despesas recorrentes**~~ (`/financeiro/contas-pagar/recorrentes`) | a primeira versão desta leva criou a tela | **removida.** A rota, a view e o formulário de regra saíram; nada no sistema aponta para lá |

Prints (desktop e celular) em `docs/prints/contas-pagar-recorrentes/`, `antes-*` e `depois-*`.

---

## Como a repetição se configura

**Configurações de repetição** é um seletor, não cinco campos soltos. Cada opção é a regra inteira
(intervalo + término) de uma vez:

| Opção | Intervalo | Termina |
| --- | --- | --- |
| Mensal: todo mês, sem data para terminar | 1 mês | nunca (horizonte rolante) |
| Mensal: todo mês, 12 vezes | 1 mês | 12 ocorrências |
| Mensal: todo mês, 24 vezes | 1 mês | 24 ocorrências |
| Trimestral: a cada 3 meses, sem data para terminar | 3 meses | nunca |
| Anual: todo ano, sem data para terminar | 12 meses | nunca |
| **Personalizar…** | 1 a 60 meses | por número de ocorrências, por mês/ano, ou sem data |

"Personalizar…" abre um diálogo com **Frequência da recorrência** ("Repetir a cada N meses") e
**Término da recorrência** (as três opções). Confirmado, o seletor passa a mostrar a regra montada
em texto — *"A cada 2 meses, 6 vezes"* — e não some: a regra escolhida continua visível.

**Condição de pagamento** tem "Cobrar sempre no" (1º a 31º dia do mês) e "1º vencimento". Os dois
são a mesma verdade vista de dois ângulos e andam juntos: mudar a data muda o dia, e mudar o dia
muda a data. Quem pensa "todo dia 10" usa o primeiro; quem pensa "começa em 10/12" usa o segundo.

**Recorrências previstas** é a prévia, recolhida por padrão, com a contagem no título. Aberta,
mostra uma linha por ocorrência — vencimento (já com o ajuste de fim de semana aplicado), o
lançamento com a competência no nome e o valor. É a prova, **antes de salvar**, de que a regra faz o
que a pessoa quer. Sem data para terminar, ela mostra o horizonte que o sistema abre de uma vez
(13 meses); com término, mostra **todas** as ocorrências.

## Padrão da casa

- **Sucesso é toast; erro fica na tela.** Criar, repetir e cancelar avisam por toast, dizendo o
  número: *"Lançamento repetido criado: 13 contas abertas."*, *"Conta 0042 cancelada e repetição
  encerrada."* O erro de validação fica no formulário, onde a pessoa está olhando.
- **Instrução no ⓘ**, não solta na tela: o que o toggle faz, e o que a prévia mostra quando a regra
  não tem data para terminar.
- **A confirmação da casa cede lugar à escolha de alcance** no cancelamento de uma conta repetida:
  perguntar "tem certeza" duas vezes é pior do que perguntar "até onde" uma vez.
- **Permissão nos botões**: sem `Financeiro › fluxo de caixa` não aparece "Repetir lançamento", nem
  editar, nem cancelar. O servidor recusa igual (403) e **a tela não muda** quando ele recusa: o
  motivo vem em toast de erro.
- **Plural escrito**: "1 conta aberta" × "13 contas abertas".

## Dinheiro é razão (na tela também)

- **Conta paga não muda**: na edição ela não ganha a escolha de alcance; "esta e as próximas"
  encerra a repetição mas não mexe no que já foi pago.
- **Repetir lançamento não recria nada**: o diálogo diz, antes de confirmar, que a conta continua
  com o mesmo número, os mesmos pagamentos e o mesmo histórico, e passa a ser a primeira ocorrência.
- **Cancelar é cancelar, não apagar**: as duas opções passam pela rota de pular (a conta fica
  CANCELADA, no histórico); nenhuma chama DELETE.
- O valor é o de **cada** ocorrência: a dica ao lado do campo diz "não multiplica".

---

## Decisões tomadas

- **Nada de tela de regras.** A repetição mora na conta. Sem lista de regras, sem item na barra
  lateral, sem botão no topo: a conta a pagar continua sendo a única coisa que a pessoa abre.
- **Sem "pausar" na tela.** O motor sabe pausar (parte 1), mas pela conta a decisão real é por
  ocorrência (*cancelar só esta*) ou pelo futuro (*esta e as próximas*). Pausar virava um terceiro
  estado para a pessoa controlar de um lugar que não existe mais.
- **O "Personalizar…" é um diálogo, não campos abertos.** Fora dele, a tela mostra uma linha de
  texto com a regra. Oito campos sempre à mostra para um caso que é quase sempre "todo mês" seria
  poluição.
- **A frequência não é guardada duas vezes.** A tela dirige o **passo em meses**; não existe um
  campo "frequência" paralelo. (Existia, e foi exatamente ali que o passo se perdia: "a cada 3
  meses" chegava ao servidor como 1.)
- **O boleto fica fora da regra.** Boleto é de uma conta: cada ocorrência cola o seu quando chega.
- **"Manual" no filtro Origem passou a excluir as recorrentes.** Antes de existir repetição,
  "Manual" significava "sem nota e sem pedido"; agora a conta de uma repetição não é manual.
- **Os selos não viraram pílula na coluna Situação.** A primeira versão colocou "recorrente" e
  "a confirmar" ali, e o print mostrou o estrago: a coluna é estreita e as pílulas escreviam por
  cima do valor. "recorrente" é **origem** (foi para a Descrição, junto do NF/Pedido) e
  "a confirmar" qualifica o **valor** (foi para baixo do número).
- **Os campos da repetição são um bloco só** (`components/financeiro/campos-recorrencia.tsx`), usado
  nos dois lugares que mexem nela: o toggle da conta nova e "Repetir lançamento" de uma conta que já
  existe. A validação é a **mesma** do servidor (`validarRegra`), então a tela nunca pede o que a
  rota recusa.

## Perguntas em aberto (para o Zé decidir)

1. **"Data de criação" na prévia.** No sistema de hoje a prévia tem essa coluna porque lá cada
   lançamento nasce no mês dele. Aqui o sistema abre todas de uma vez (horizonte rolante), então a
   coluna diria sempre "hoje" — mentira útil para ninguém. Ficou de fora. Se a ideia é criar mês a
   mês, isso é outra decisão (muda a geração, não a tela).
2. **"Conta de pagamento" na repetição.** Contas a pagar não tem campo de conta bancária hoje
   (quem tem é contas a receber). Entrar com ele aqui seria criar o campo no módulo inteiro, não só
   na repetição. Não entrou.

## Testes

| Arquivo | O que prova |
| --- | --- |
| `tests/unit/conta-pagar-recorrentes-telas.test.ts` | as regras puras do formulário (início sugerido, atalhos que escrevem passo + término, ida e volta de uma regra existente, o texto da repetição, a prévia com todas as ocorrências, a validação da rota) e as guardas: a tela de regras não existe mais, nada aponta para a rota removida, o cancelamento com alcance encerra a regra pela rota de ação e cancela pela de pular (nunca DELETE), permissão em cada rota, filtro no servidor, cron |
| `tests/unit/conta-pagar-recorrentes-ui.test.ts` | num DOM de verdade: o toggle desligado não muda nada; ligado cria a repetição; a prévia com as contas que vão nascer; o "Personalizar…" valendo de verdade; favorecido colaborador; o alcance na edição (e a ausência dele na conta paga); o selo nas duas versões da lista; quem só visualiza; a recusa do servidor que não muda a tela |
