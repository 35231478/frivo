# Padronização de telas — leva 2

A leva 1 criou o "editar no contexto" (lápis + painel, com o rótulo do que está sendo editado). Esta
leva **liga** isso nas telas de **OS** e de **Orçamento**, põe em uso o modo "uso" e a **trava de
registro fechado**. Sem alteração de banco.

## A regra de ouro, por campo

| O que se edita | Escopo | Título do painel | Vale |
|---|---|---|---|
| Cliente (telefone, celular, e-mail) e os contatos dele | Referência | "Editando o cadastro do cliente" | Em todo lugar |
| Unidade / local (nome e endereço) | Referência | "Editando o cadastro da unidade" | Em todo lugar |
| Equipamento (identificação, marca, modelo, série, patrimônio, ambiente) | Referência | "Editando o cadastro do equipamento" | Em todo lugar |
| Contato A/C do orçamento | Referência | "Editando o cadastro do contato" | Em todo lugar |
| Linha de serviço ou de produto da OS | **Uso** | "Editando este item da OS" | Só nesta OS |
| Linha de serviço ou de produto do orçamento | **Uso** | "Editando este item do orçamento" | Só neste orçamento |

A faixa do painel repete o alcance: "Vale em todo lugar onde este cadastro é usado." (referência) ou
"Vale só aqui. O cadastro não muda." (uso).

**Serviço e produto do catálogo nunca são editados de dentro da transação.** A edição a partir da OS
ou do orçamento é sempre a linha. O painel da linha não tem link para o catálogo, e as definições de
serviço e de produto continuam só com o "criar". O cadastro-mãe deles fica na tela do catálogo.

## Onde está ligado

### OS — abertura (`/ordens/nova`)

- **Cliente**: lápis ao lado do seletor → telefone, celular, e-mail e os contatos.
- **Endereço do cliente**: lápis ao lado do seletor → nome e endereço da unidade.
- **Equipamento** (ao aceitar uma solicitação) e **cada equipamento atendido** da lista.
- Tipo de OS: já vinha da leva 1.

### OS — central (`/ordens/[id]`)

- **Resumo › Cliente e local**: lápis no cliente e no endereço.
- **Atividades**: lápis em cada equipamento vinculado.
- **Comercial › Itens da OS**: o lápis de cada linha abre "Editando este item da OS" — descrição,
  quantidade e o preço aplicado nesta OS. Os materiais do serviço continuam no editor completo, por
  "Materiais e peças deste item", que mostra a mesma faixa de uso.

### Orçamento

- **Formulário** (novo e editar): lápis no cliente, na unidade do "Para:" e no contato A/C. O ⓘ das
  tabelas de serviços e de produtos diz que as linhas valem só naquele orçamento.
- **Detalhe** (`/orcamentos/[id]`): cada linha do documento interno tem o lápis de "Editando este item
  do orçamento" — descrição, quantidade, preço e observação. A coluna some na impressão, e o
  documento que o cliente vê (link público) não tem lápis.

## O retrato copiado

O documento guarda o que foi lançado. Editar a linha grava **só a linha**:

- o serviço e o produto de origem não são lidos nem gravados;
- os materiais copiados para a linha (`os_materiais`, `orcamento_materiais`) ficam como estão — mesmos
  registros, mesmos valores — e as peças derivadas também;
- reprecificar, renomear ou mudar a composição do serviço no catálogo depois **não reescreve** as
  linhas já lançadas. Uma OS nova pega o catálogo novo; a antiga continua com o retrato dela.

No serviço com materiais, o preço que o painel edita é o **unitário base**: o total continua sendo base
+ ajuste dos materiais inclusos. Linha com total digitado à mão não oferece o unitário (o preço dela é
o total, que muda em "Materiais e peças").

## Trava de registro fechado

Regras puras em `lib/edicao-contexto.ts`; o servidor confere de novo (`lib/os/trava-edicao-server.ts`).

**OS fechada** — concluída, assinada pelo cliente, faturada ou com nota fiscal emitida:

- as linhas viram **cadeado desabilitado**, com o motivo no ⓘ;
- não há lixeira nem "novo item"; uma faixa no rodapé dos itens diz o motivo;
- o servidor recusa editar, regravar, apagar e incluir linha, com o mesmo motivo;
- **"Marcar executado" continua** — é o que leva a OS ao faturamento;
- reabrir a OS (ajuste manual do status) destrava as linhas.

Motivos, do mais definitivo para o menos: nota fiscal emitida → faturada → assinada pelo cliente →
concluída. Fatura cancelada e nota rejeitada, cancelada ou interrompida não travam; nota a caminho
(enviando ou processando) já trava.

**A trava é do uso, não da referência.** Na OS fechada, o cliente, a unidade e o equipamento continuam
editáveis no cadastro deles — os lápis do cartão "Cliente e local" seguem habilitados.

**Linha que não se edita por ela mesma** (com a OS aberta), também com cadeado e motivo: peça derivada
de um material do serviço, item copiado do orçamento aprovado e item já executado.

**Orçamento** — só o rascunho se edita (a regra que o servidor já tinha). Aprovado, convertido, faturado
e com nota são registro fechado; enviado, reprovado e cancelado mostram o cadeado com a frase de cada
um ("volte para rascunho para editar").

## Permissões

| Lápis | Permissão |
|---|---|
| Cliente, contato, unidade | Clientes › editar |
| Equipamento | Equipamentos › editar |
| Linha da OS (e lixeira, "marcar executado", "novo item") | Ordens › editar |
| Linha do orçamento | Orçamentos › editar |

Sem a permissão o lápis não aparece (nem o cadeado), e o servidor recusa de qualquer jeito (403).

## Como salva

Só vai para o servidor o que mudou; nada mudou, fecha sem gravar. Salvou: toast. O formulário principal
da OS ou do orçamento não é enviado nem perde o que tinha. Números à brasileira ("1.250,50"); o que não
é número não vira zero — o painel avisa.

Rotas (todas parciais e estritas — campo fora da lista é recusado):

| Rota | Campos |
|---|---|
| `PATCH /api/clientes/[id]` | telefone, celular, email (com `{ ativo }` continua inativando, como sempre) |
| `PATCH /api/clientes/[id]/contatos/[contatoId]` | nome, cargo, telefone, email |
| `PATCH /api/unidades/[id]` | nome, cep, logradouro, numero, complemento, bairro, cidade, estado |
| `PATCH /api/equipamentos/[id]` | nome, marca, modelo, numeroSerie, patrimonio, localizacao |
| `PATCH /api/ordens/[id]/orcamento/[itemId]` | descricao, quantidade, valorUnitario |
| `PATCH /api/orcamentos/[id]/linhas/[linhaId]` | descricao, quantidade, valorUnitario, observacao |

Na linha do orçamento, os totais (desconto, ISS, serviço com materiais) saem da mesma conta do salvar
do formulário (`montarValoresOrcamento`).

## Para ligar em outra tela

```tsx
// Seletor: passe `edicao`
<SelectCadastroRapido ... edicao={CLIENTE.edicao()} />

// Onde não há seletor: o lápis avulso
<EditarNoContexto id={os.cliente.id} rotulo="Editar o cadastro do cliente" edicao={CLIENTE.edicao()} />

// Linha de um documento: escopo "uso" + a trava
<EditarNoContexto id={linha.id} rotulo={`Editar ${linha.descricao}`} edicao={{
  escopo: "uso", alvo: "este item da OS", travado: motivoDaLinhaDaOs(linha, situacaoDaOs(os)),
  campos, valores, salvar, permissao: { modulo: "ordens", acao: "editar" },
}} />
```

Definições prontas em `components/cadastro-rapido/definicoes.ts`: `CLIENTE.edicao`, `CONTATO.edicao`,
`UNIDADE.edicao`, `EQUIPAMENTO.edicao` (e `TIPO_OS.edicao`, da leva 1).

## O que não entrou

- **Desconto por linha** e **observação na linha da OS**: não existem no banco (a linha do orçamento
  tem observação; desconto é por grupo, no orçamento inteiro). Criar seria alteração de schema.
- Editar o cadastro do serviço ou do produto de dentro da OS ou do orçamento (de propósito).
- Proposta de contrato (o documento dela não tem linhas de serviço e produto).
- Outros módulos (contrato, medição, PMOC).

## Testes

- `tests/unit/edicao-contexto.test.ts` — regras puras (situação, trava por documento e por linha,
  número à brasileira).
- `tests/unit/padronizacao-leva2-pg.test.ts` — rotas reais com PostgreSQL real: referência parcial e
  estrita, uso, retrato copiado que não muda com o catálogo, trava com o motivo, RBAC e multiempresa.
- `tests/unit/padronizacao-leva2-ui.test.ts` — telas num DOM de verdade: painéis de referência e de
  uso, contatos, cadeado, permissões, e onde está ligado.

Conferência desta leva: suíte inteira verde (380 arquivos, 5.346 testes); mutação com 172 mutantes, 170
pegos e 2 equivalentes (o `.strict()` final dos esquemas das linhas repete o que o esquema de origem já
garante); e um roteiro no navegador de verdade (Chromium, desktop e celular) com 95 verificações.

Prints em `docs/prints/padronizacao-leva2/` (`antes-*` e `depois-*`, desktop e celular).
