# Seletores com busca — o que virou busca e o que fica nativo

**Critério** (o do Zé): **busca** quando a lista aponta para um cadastro que cresce (produto,
cliente, equipamento, unidade, fornecedor, serviço, colaborador, categoria, centro de custo…);
**`<select>` nativo** quando a lista é fixa e curta (status, frequência, periodicidade, meses, UF,
parcelas, tipo de campo…). Em lista curta a busca não ajuda, e o nativo é melhor no celular.

---

## O componente da casa

`components/ui/busca-select.tsx` — escolha única com busca. Digitar filtra (sem acento e sem caixa:
"jose" acha "José"); teclado inteiro (↓ abre, ↑↓ andam, Enter escolhe, Esc fecha e devolve o foco,
Tab sai, Home/End); no celular a lista ocupa a largura do campo e o campo de busca já vem com foco;
`acao` põe "＋ Novo …" no pé da lista; lista grande desenha as 60 primeiras e diz quantas ficaram
de fora ("e mais N — pesquise para afinar").

`components/cadastros/seletor-cadastro.tsx` (`SeletorCadastro`) passou a usar esse componente. É o
seletor padrão de qualquer cadastro do registro, então **toda tela que já o usava ganhou busca de
uma vez**, mantendo o que tinha: "+ Novo …" (cadastro rápido), o lápis de editar no contexto, o
item inativo que continua visível quando é o valor atual, e a permissão de criar/editar.

---

## Convertidos

| Onde | Seletor | Por quê |
| --- | --- | --- |
| `/compras/pedidos/novo` e `/compras/pedidos/[id]` | **Produto** da linha do pedido | o pedido da reclamação: cadastro que cresce. Mantém "Manual / digitar" e "+ Novo produto" |
| OS › Materiais, Orçamento › Materiais | **Produto**, **Serviço**, **Kit**, **material avulso** | catálogo que cresce |
| Nota de compra (conciliação e financeiro) | **Produto**, **Categoria**, **Centro de custo** | cadastros que crescem |
| Contrato | **Serviço da nota** | catálogo de serviços |
| Medição / faturamento | **Cliente**, **Contrato** | cadastros que crescem |
| Contas a pagar (filtros) | **Fornecedor**, **Categoria**, **Centro de custo** | cadastros que crescem |
| Contas a receber (filtros e edição) | **Cliente**, **Categoria**, **Conta bancária**, **Centro de custo** | cadastros que crescem |
| Ações em lote (receber/pagar) | **Conta bancária** | cadastro que cresce |
| Configurações › Produtos | **Categoria do produto** | cadastro que cresce |
| Configurações › Kits de material | **Produto** de cada item | catálogo |
| Configurações › Serviços › Materiais padrão | **Produto**, **Kit** | catálogo |
| Fiscal › aplicar dados fiscais | **Serviço modelo** | catálogo |
| Fiscal › emitir NFS-e | **Serviço** do item sem serviço | catálogo |
| Ficha do colaborador, equipes, veículos, equipamentos, clientes, unidades… | todos os seletores de cadastro do registro | mesmo componente |

> Todos esses passam pelo mesmo `SeletorCadastro`: a conversão foi **no componente**, não tela a
> tela. Nada paralelo foi criado.

## Mantidos nativos (lista fixa e curta)

| Onde | Seletor | Por quê |
| --- | --- | --- |
| Contas a pagar / a receber | Situação, Origem, Tipo de vencimento | enum |
| Repetição da conta a pagar | Configurações de repetição, Cobrar sempre no (1–31), Fim de semana | lista fixa |
| Contratos (lista e relatório) | Status, Frequência, Mês | enum / 12 itens |
| Ordens (lista) | Status, Prioridade, Origem | enum |
| Fiscal (central de notas) | Situação, Ambiente | enum |
| Faturamento | Parcelas (à vista, 2×, 3×…) | lista fixa |
| Fluxo de caixa, relatórios | Mês, Ano | lista fixa |
| Configurações › Formulários | Tipo do campo | enum |
| Cadastro de apoio | Tipo de resposta do checklist, comportamento do material | enum |
| App do técnico | Unidade da capacidade, unidade da medida, tipo de equipamento | lista fixa e curta |
| Colaborador | Tipo de documento | enum |
| Listagens | Itens por página, Ordenar por | lista fixa |
| Qualquer tela | UF | 27 itens fixos — nativo é melhor no celular |

## Os `<select>` soltos que também viraram busca

Estes não passavam pelo `SeletorCadastro` — eram `<select>` escritos na própria tela. Viraram o
mesmo `BuscaSelect`:

| Onde | Seletor | Por quê |
| --- | --- | --- |
| OS › quem executa | **Veículo** | a frota cresce; digitar filtra placa e modelo |
| OS › colaboradores | **"Habilitar a competência num colaborador…"** | lista de colaboradores |
| Nota de compra › conciliação | **Pedido de compra** | pedidos em aberto crescem |
| Relatório de contratos (filtros) | **Colaborador**, **Cliente** | cadastros que crescem |
| Portal do cliente › abrir chamado | **Unidade**, **Equipamento** | um cliente pode ter muitas das duas |

## Olhados e mantidos nativos de propósito

| Onde | Seletor | Por quê |
| --- | --- | --- |
| Ordens (lista) | Tipo de OS | cadastro de apoio: na prática são poucos, e o filtro é curto |
| Equipes (lista) | Perfil de acesso | uma empresa tem meia dúzia |
| App do técnico › execução | Equipamento da foto, equipamento do serviço extra | são os equipamentos **daquela OS** (lista curta), e com a luva o seletor nativo do celular é melhor |
| App do técnico › cadastro em campo | Tipo de equipamento, unidade da capacidade | lista fixa |

## O que existe de paralelo (e a decisão)

`components/ui/select-cadastro-rapido.tsx` (`SelectCadastroRapido`) **já tem busca própria** (campo
de pesquisa quando passa de 6 opções) e é o que a OS, o orçamento, o contrato e o PMOC usam para
cliente, equipamento, unidade e colaborador. Ou seja: essas telas **não** sofrem do problema
relatado. Mas são dois componentes da casa fazendo a mesma coisa.

**Decisão:** não unificar nesta leva. O `SelectCadastroRapido` carrega mini-cadastro, edição no
contexto, descrição por opção e ícone; fundir os dois é uma leva inteira, com risco em telas
centrais (OS e orçamento). Fica anotado como a próxima da fila, para a casa terminar com **um**
seletor com busca, não dois.
