# Padronização de telas — inventário e plano de levas

Inventário das telas do painel contra o checklist da padronização, para planejar as levas por módulo.
Feito em 14/11/2026, com o código da leva 2; a tabela de Configurações e o placar foram revistos na leva 3,
as de Clientes e de Equipamentos e QR Codes na leva 4A, e a de Equipes, colaboradores e frota na leva 4B.

## Como foi feito (e o limite disto)

Uma **varredura automática do código** de cada tela (a página e os componentes próprios que ela usa, até
dois níveis), procurando os componentes do padrão: cabeçalho, cadastro padrão e lista padrão, paginação
no servidor, o ⓘ (`Dica`), o toast, a checagem de permissão nos botões, o cadastro inline nos
seletores, a edição no contexto e as classes de celular.

É um **primeiro mapa, não um veredito**. "—" quer dizer que a varredura não achou o componente — não que
a tela esteja errada: um relatório não precisa de toast, e uma tela pode ter o botão certo por outro
caminho. Antes de cada leva, as telas do módulo são abertas e conferidas uma a uma (como foi nas levas 1
e 2). O que a varredura **não mede**: vocabulário, parágrafo de instrução solto na tela, e se a tela
"cabe" de verdade no celular.

A [auditoria operacional](auditoria-operacional.md) (06/10/2026) é de defeitos, não de padrão de tela;
os itens dela que tocam em tela estão citados na leva correspondente.

## Placar

Números da varredura automática, depois da leva 4A. A varredura não segue arquivo vizinho (`./x-client`) nem
reconhece a tabela ligada à URL: por isso `/clientes`, `/equipamentos`, `/qrcodes` e `/qrcodes/imprimir`, feitas
na 4A e conferidas no navegador, ainda contam aqui como pendentes em lista padrão, toast, ⓘ, permissão e celular.
A tabela de cada módulo, mais abaixo, traz o estado conferido.

| | Telas |
|---|---|
| Telas do painel inventariadas | **111** (fora 35 rotas antigas que só redirecionam) |
| Já usam a lista padrão | 30 |
| Com tabela própria | 23 |
| Sem toast | 44 |
| Sem ajuda no ⓘ | 34 |
| Sem checagem de permissão nos botões | 15 |
| Com seletor e sem cadastro inline | 26 |
| Com cadastro inline e sem edição no contexto | 16 |
| Sem classes de celular | 26 |
| Com `alert()`/`confirm()` nativo | 0 |

## O que já está feito

- **Leva 1** (mergeada): componentes compartilhados — editar no contexto, ajuda no ⓘ, padrão de lista —
  e os cadastros de apoio (tipos de OS, tipos de problema, tipos de equipamento, categorias, centros de
  custo, cargos, kits) no mesmo esqueleto. Ver [padronizacao-leva1.md](padronizacao-leva1.md).
- **Leva 2** (mergeada): edição no contexto ligada na OS (abertura, central, atividades) e no orçamento
  (formulário e detalhe), com a trava de registro fechado — que vale a partir de OS assinada pelo
  cliente, faturada ou com nota emitida (OS só concluída continua editável). Ver
  [padronizacao-leva2.md](padronizacao-leva2.md).
- **Leva 3**: telas pequenas de Configurações — botões de gravar só para quem tem a permissão, padrão
  de lista em formulários, checklists de veículo, numeração e padronização, toast em toda gravação e
  instrução no ⓘ. Ver [padronizacao-leva3.md](padronizacao-leva3.md).
- **Leva 4A**: Clientes, Equipamentos e QR Codes — listas na tabela da casa, QR Codes no celular e com
  desvincular, inativar e reativar por permissão, toast em toda gravação, editar cliente e unidade no
  contexto e a consulta de CNPJ no cadastro rápido de cliente. Ver
  [padronizacao-leva4a.md](padronizacao-leva4a.md).
- **Leva 5**: Operação — o botão "Editar" morto da OS virou a gaveta "Editar OS" (com a trava do
  registro fechado na tela e no servidor), sugestões do histórico do cliente na abertura da OS,
  permissão nos botões do calendário e `/prazos`, `/pmoc`, `/calendario` e `/ordens` no padrão. Ver
  [padronizacao-leva5.md](padronizacao-leva5.md).
- **Leva 6A**: Comercial — as quatro telas de contrato. A ficha não checava permissão nenhuma e passa a
  abrir em somente leitura para quem só visualiza; "Novo contrato" e "Gerar OS" por permissão;
  reajustes e lista na tabela da casa; cliente, responsável técnico e os seletores da recorrência com
  cadastro rápido e editar no contexto. Ver [padronizacao-leva6a.md](padronizacao-leva6a.md).
- **Leva 6B**: Comercial — a lista de Orçamentos ("Novo orçamento" passa a exigir Orçamentos › criar) e
  os Leads do site (tabela da casa com cartões no celular, descartar e reabrir pelas rotas que já
  existiam, filtro "Descartados" com quem descartou e quando, atalho para a ficha do cliente), mais as
  sugestões de item do orçamento: o que o cliente mais contratou nos últimos 6 meses, com o último
  preço praticado. Ver [padronizacao-leva6b.md](padronizacao-leva6b.md).
- **Leva 7A**: Estoque que mexe em saldo — ⓘ na lista e no extrato contando a regra do razão (movimento
  não se apaga: corrigir é ajuste ou inventário), as duas filas (a separar / a devolver) na tabela da
  casa com cartões no celular, a planilha da separação nos tokens da casa, toast em todo lançamento e
  no preço de venda, e a prova em teste de que o 403 não muda a tela. Ver
  [padronizacao-leva7a.md](padronizacao-leva7a.md).
- **Leva 4B** (🔵, com SQL): Veículos, Colaboradores e Equipes — checklist de veículo preenchido com
  detalhe, edição e exclusão reversível; responsável técnico cadastrado na hora em Dados da empresa;
  aba Inativos com Reativar nos formulários de OS e nos modelos de checklist; listas na tabela da casa e
  toast em toda gravação. Ver [padronizacao-leva4b.md](padronizacao-leva4b.md).

## Próximas levas (ordem sugerida)

Um PR por leva, cada um com 🟢 (sem banco) ou 🔵 (com SQL). A ordem vai do que mais atrapalha o uso
diário para o que menos atrapalha, e do menor para o maior.

| Leva | Módulo | Telas | Por que nesta ordem |
|---|---|---|---|
| 6B | **Comercial** | Lista de orçamentos, leads do site (com ações) e as sugestões de item no orçamento e no contrato | A 6A fez contratos; sobra o que depende das sugestões do histórico do cliente |
| 7 | **Estoque e compras** | Estoque, separação, devolução, notas de entrada, pedidos de compra | Telas-planilha de operação; padronizar a lista e os avisos |
| 8 | **Financeiro** | Contas a pagar e a receber (fichas e formulários), medições, faturas, custo de pessoal, fluxo de caixa | Maior módulo. As listas já estão no padrão; faltam fichas e formulários. **Não mexe em pagamento** |
| 9 | **Desempenho** | Painel, ficha, fechamento, premiações, configuração, revisão | Módulo novo, com padrão próprio; alinhar por último |

Ficam de fora do plano, de propósito: login e segurança, RBAC do painel, pagamento, exclusão de dados e
o app do técnico (tem padrão próprio de celular).

## Sugestões que reduzem trabalho repetitivo

Regra: **sugere, não preenche no escuro**; sempre editável; a tela diz de onde veio a sugestão; nada com
cara de IA. Cada sugestão entra na leva da tela em que ela aparece.

| Sugestão | Onde | Hoje | Leva |
|---|---|---|---|
| CEP → endereço | Cadastro de cliente, unidade e os cadastros rápidos | **Já existe** | — |
| CNPJ → dados do cliente | Cadastro de cliente | **Já existe** no cadastro completo; **falta** no cadastro rápido (de dentro da OS e do orçamento) | 4 |
| Último técnico ou equipe que atendeu o cliente | Abertura da OS e nova atividade | Não existe | 5 |
| Tipo de OS mais usado no cliente | Abertura da OS | Não existe | 5 |
| Serviços e materiais frequentes do tipo de OS | Itens da OS e do orçamento | Não existe (há a composição padrão do serviço) | 5 e 6 |
| Preço praticado para o cliente | Itens da OS e do orçamento | **Parcial**: a tabela de preço do cliente já entra; falta mostrar o último preço cobrado dele | 5 e 6 |
| Contato A/C usual do cliente | Orçamento | **Já existe** (contato principal) | — |

Cada uma precisa de uma decisão antes de entrar: de quantos atendimentos para trás a sugestão olha, e o
que fazer quando há empate ou pouco histórico (a proposta é não sugerir nada).

## Inventário por módulo

### Configurações (28)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/configuracoes` | — | — | — | — | sim | — | — | sim | índice de cartões, conferido na leva 3: os cartões já vêm filtrados pela permissão no servidor |
| `/configuracoes?secao=banco-inter` | — | — | sim | sim | sim | — | — | sim | feita na leva 3 |
| `/configuracoes?secao=cargos` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=categorias-financeiras` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=categorias-produto` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=centros-custo` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=dados-fiscais` | — | — | sim | sim | sim | — | — | sim | cadastro inline nos seletores |
| `/configuracoes?secao=email` | — | — | sim | sim | sim | — | — | sim | feita na leva 3 |
| `/configuracoes?secao=email-templates` | — | — | sim | sim | sim | — | — | sim | feita na leva 3 |
| `/configuracoes?secao=empresa` | — | — | sim | sim | sim | — | — | sim | feita na leva 3; falta o cadastro rápido do responsável técnico (leva dos cadastros principais) |
| `/configuracoes?secao=formularios` | sim | — | sim | sim | sim | sim | sim | sim | feita na leva 3; a busca é na tela (lista curta, vem inteira); falta reativar o inativado |
| `/configuracoes?secao=impressao-os` | — | — | sim | sim | sim | — | — | sim | feita na leva 3 |
| `/configuracoes?secao=kits-material` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=numeracao` | sim | — | sim | sim | sim | — | — | sim | feita na leva 3 (lista fixa de documentos) |
| `/configuracoes?secao=orcamento` | — | — | sim | sim | sim | — | — | sim | feita na leva 3 |
| `/configuracoes?secao=padronizacao` | sim | — | sim | sim | sim | — | — | sim | feita na leva 3 |
| `/configuracoes?secao=perfis` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=portal` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=prazos` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=produtos` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=qr-code` | — | — | sim | sim | sim | — | — | sim | feita na leva 3 |
| `/configuracoes?secao=servicos` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=tabelas-preco` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=termos` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=tipos-equipamento` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=tipos-os` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes?secao=usuarios` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/configuracoes/checklists-veiculo` | sim | — | sim | sim | sim | — | — | sim | feita na leva 3; a busca é na tela; falta reativar o inativado |

### Clientes (3)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/clientes` | sim | sim | sim | sim | sim | sim | — | sim | feita na leva 4A; lista não tem seletor para editar no contexto |
| `/clientes/[id]/editar` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/clientes/novo` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |

### Equipamentos e QR Codes (7)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/equipamentos` | sim | sim | sim | sim | sim | sim | — | sim | feita na leva 4A; a busca e a página são pela URL (servidor) |
| `/equipamentos/[id]` | — | — | — | sim | sim | — | — | sim | conferida na leva 4A: cabe no celular e não tem instrução solta |
| `/equipamentos/[id]/editar` | sim | — | sim | sim | sim | sim | sim | sim | feita na leva 4A |
| `/equipamentos/novo` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 4A |
| `/equipamentos/novo/foto` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 4A; o aviso de privacidade fica visível de propósito |
| `/qrcodes` | sim | — | sim | sim | sim | — | — | sim | feita na leva 4A; Gerar e Vincular já seguiam a permissão (a varredura não segue o arquivo vizinho) |
| `/qrcodes/imprimir` | — | — | sim | — | — | — | — | sim | feita na leva 4A; só imprime (não grava: sem toast nem botão por permissão) |

### Ordens de serviço, calendário, prazos e mapa (7)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/calendario` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 5: ⓘ no título, toast da casa (tinha um próprio), cadastro inline e editar no contexto no diálogo "Nova OS", criar e arrastar conforme a permissão; os filtros do painel seguem filtros |
| `/mapa` | — | — | — | — | sim | — | — | — | toast; ajuda no ⓘ; versão de celular |
| `/ordens` | sim | sim | sim | — | sim | sim | — | sim | conferida na leva 5: ⓘ acrescentado; a tela não grava nada (as ações em massa mostram o resultado item a item na barra compartilhada) |
| `/ordens/[id]` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 2 (referência × uso nos itens; as linhas travam com a OS assinada, faturada ou com nota) e na leva 5: o botão "Editar" era morto (rota que só redirecionava) e passou a abrir a gaveta "Editar OS", com a mesma trava na tela e no servidor (409) |
| `/ordens/[id]/atividades/[atividadeId]/executar` | — | — | — | sim | sim | — | — | — | ajuda no ⓘ; cadastro inline nos seletores; versão de celular |
| `/ordens/nova` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 5: sugestões do histórico do cliente (tipo e quem executa), que dizem de onde vêm e só entram no "Usar" |
| `/prazos` | sim | sim | sim | — | — | — | — | sim | feita na leva 5: ⓘ, filtros da casa, estado vazio compartilhado, celular. Não grava nada e não tem botão destrutivo (o prazo é cumprido dentro da OS): sem toast e sem permissão a acrescentar; os dois campos são filtros, não cadastros |

### PMOC (3)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/pmoc` | sim | sim | sim | sim | sim | — | — | sim | feita na leva 5: a tabela própria (e o `take: 500` sem paginação) virou TabelaPro com busca, filtros e página pela URL; a base legal foi para o ⓘ. Não tem seletor de cadastro: a lista só filtra |
| `/pmoc/[id]` | sim | — | sim | sim | sim | sim | sim | sim | feita na leva 5: equipamentos cobertos em TabelaPro, toast na gravação (erro fica na tela), cliente/unidade com editar no contexto e o RT no cadastro rápido da casa |
| `/pmoc/novo` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 5: o mesmo editor do `/pmoc/[id]` (as abas de equipamentos e cronograma só existem com o plano salvo) |

### Comercial: orçamentos, contratos e leads (10)

> As cinco telas de contrato foram feitas na **leva 6A** (`docs/padronizacao-leva6a.md`); a lista de
> orçamentos, os leads do site e as sugestões de item, na **6B** (`docs/padronizacao-leva6b.md`). As
> três telas do formulário de orçamento (`/orcamentos/[id]`, `/orcamentos/[id]/editar` e
> `/orcamentos/novo`) seguem na fila.

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/contratos` | sim | sim | sim | — | sim | — | — | sim | feita na leva 6A: a tabela própria virou TabelaPro (colunas escolhíveis, totais na faixa de cima), a instrução foi para o ⓘ, "Novo contrato" só com Contratos › criar, lista vazia da casa e plural escrito. Não grava nada (as ações em massa mostram o resultado na barra compartilhada) e não tem seletor de cadastro: o filtro de cliente só filtra |
| `/contratos/[id]/editar` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 6A: não checava permissão nenhuma — agora abre em somente leitura (fieldset desabilitado, sem Salvar nem menu de status) para quem só tem Contratos › visualizar; cliente com editar no contexto, RT e os dois seletores da recorrência no cadastro rápido da casa, prévia das próximas OS na planilha |
| `/contratos/novo` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 6A: passa a exigir Contratos › criar (era aberta a todos); mesmo formulário do `/contratos/[id]/editar` |
| `/contratos/reajustes` | — | — | sim | sim | sim | — | — | sim | feita na leva 6A: tabela própria → TabelaPro (cartões no celular), aplicar/adiar/dispensar só com Contratos › editar. Não tem seletor: é uma fila de decisão |
| `/contratos/relatorio` | — | — | sim | sim | sim | — | — | sim | feita na leva 6A: ⓘ no título e "Gerar OS" só com Ordens › criar ou Contratos › editar (era o único botão que gravava sem checar nada). Os três campos do topo são filtros, não cadastros; a tela é de cartões expansíveis (já servia no celular) |
| `/leads-site` | sim | sim | sim | sim | sim | — | — | sim | feita na leva 6B: a tabela própria virou TabelaPro com cartões no celular, a instrução foi para o ⓘ, entraram Descartar (Orçamentos › excluir) e Reabrir (Orçamentos › editar) pelo componente e pelas rotas da casa, com o filtro "Descartados" dizendo quem descartou e quando, e um atalho para a ficha do cliente. Não tem seletor de cadastro: o lead já nasce com cliente |
| `/orcamentos` | sim | sim | sim | sim | sim | sim | — | sim | feita na leva 6B: ⓘ no título e "Novo orçamento" só com Orçamentos › criar (aparecia para quem só consulta). A edição no contexto é do formulário, não da lista; cancelar/reabrir já estavam no componente da casa e agora deixam rastro de quem e quando |
| `/orcamentos/[id]` | — | — | sim | sim | sim | sim | sim | sim | tabela própria |
| `/orcamentos/[id]/editar` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/orcamentos/novo` | — | — | sim | sim | sim | sim | sim | sim | a leva 6B acrescentou a faixa de sugestões de item (o mais usado do cliente, com o último preço praticado); o resto da tela segue na fila |

### Estoque e compras (11)

> As seis telas que mexem em saldo foram feitas na **leva 7A**
> (`docs/padronizacao-leva7a.md`). As notas de compra e os pedidos ficam para a **7B**, que é o
> fluxo de comprar de ponta a ponta.

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/compras/pedidos` | — | sim | — | sim | sim | sim | — | sim | tabela própria; ajuda no ⓘ; edição no contexto |
| `/compras/pedidos/[id]` | — | — | — | sim | sim | sim | — | sim | tabela própria; ajuda no ⓘ; edição no contexto |
| `/compras/pedidos/novo` | — | — | — | sim | sim | sim | — | sim | ajuda no ⓘ; edição no contexto |
| `/estoque` | sim | sim | sim | sim | sim | — | — | sim | feita na leva 7A: ⓘ com a regra do razão, toast no lançamento de movimento (entrada, saída, ajuste, inventário) e o botão do topo deixando de prometer "Importar NF" para quem não gerencia. A lista já era TabelaPro desde a E1; não tem seletor de cadastro (os produtos vêm do cadastro) |
| `/estoque/[produtoId]` | sim | sim | sim | sim | sim | — | — | sim | feita na leva 7A: ⓘ dizendo que movimento não se apaga nem se edita (corrigir é ajuste/inventário) e o preço de venda confirmando por toast |
| `/estoque/devolucao` | sim | — | sim | — | sim | — | — | sim | feita na leva 7A: tabela própria → TabelaPro, cartões e lista vazia da casa. Quem grava é a tela da OS |
| `/estoque/devolucao/[osId]` | — | — | sim | sim | sim | — | — | sim | conferida na leva 7A: já usava os componentes da casa e só gravava depois do ok do servidor; entrou como guarda de teste |
| `/estoque/notas` | — | sim | — | — | sim | — | — | sim | tabela própria; toast; ajuda no ⓘ |
| `/estoque/notas/[id]` | — | — | — | sim | sim | sim | sim | sim | ajuda no ⓘ |
| `/estoque/separacao` | sim | — | sim | — | sim | — | — | sim | feita na leva 7A: a tabela própria virou TabelaPro com os cartões de celular e a lista vazia da casa. Não grava nada (quem grava é a tela da OS): sem toast a acrescentar |
| `/estoque/separacao/[osId]` | — | — | sim | sim | sim | — | — | sim | feita na leva 7A: a planilha de trabalho passou aos tokens PLANILHA (é formulário, não listagem). Já só gravava depois do ok do servidor — agora com teste provando que o 403 não muda a tela |

### Financeiro (22)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/financeiro` | — | — | sim | — | sim | — | — | sim | toast |
| `/financeiro/contas-bancarias` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/financeiro/contas-pagar` | sim | sim | sim | — | sim | sim | — | sim | toast; edição no contexto |
| `/financeiro/contas-pagar/[id]` | — | — | — | — | — | — | — | — | toast; ajuda no ⓘ; botões por permissão; cadastro inline nos seletores; versão de celular |
| `/financeiro/contas-pagar/[id]/editar` | — | — | — | — | sim | sim | sim | — | toast; ajuda no ⓘ; versão de celular |
| `/financeiro/contas-pagar/nova` | — | — | — | — | sim | sim | sim | — | toast; ajuda no ⓘ; versão de celular |
| `/financeiro/contas-receber` | sim | sim | sim | sim | sim | sim | — | sim | edição no contexto |
| `/financeiro/contas-receber/nova` | — | — | sim | — | sim | sim | sim | — | tabela própria; toast; versão de celular |
| `/financeiro/custo-pessoal` | — | — | sim | — | sim | — | — | sim | tabela própria; toast |
| `/financeiro/custo-pessoal/colaborador/[id]` | — | — | — | — | sim | — | — | — | toast; ajuda no ⓘ; cadastro inline nos seletores; versão de celular |
| `/financeiro/custo-pessoal/encargos` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/financeiro/custo-pessoal/importar` | — | — | — | — | sim | — | — | sim | toast; ajuda no ⓘ |
| `/financeiro/faturamento-contratos` | — | — | sim | sim | sim | — | — | sim | tabela própria |
| `/financeiro/faturas/[id]` | — | — | — | — | — | — | — | — | toast; ajuda no ⓘ; botões por permissão; versão de celular |
| `/financeiro/fiscal` | — | — | sim | sim | sim | — | — | sim | cadastro inline nos seletores |
| `/financeiro/fluxo-caixa` | — | — | sim | — | sim | — | — | — | toast; cadastro inline nos seletores; versão de celular |
| `/financeiro/fornecedores` | sim | sim | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/financeiro/medicoes` | — | sim | sim | — | sim | — | — | sim | toast; cadastro inline nos seletores |
| `/financeiro/medicoes/[id]` | — | — | sim | sim | sim | sim | sim | — | tabela própria; versão de celular |
| `/financeiro/medicoes/[id]/editar` | — | — | sim | — | sim | sim | — | sim | toast; edição no contexto |
| `/financeiro/medicoes/nova` | — | — | sim | — | sim | sim | — | sim | toast; edição no contexto |
| `/financeiro/notas-fiscais` | sim | sim | sim | sim | sim | — | — | sim | cadastro inline nos seletores |

### Equipes, colaboradores e frota (12)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/colaboradores` | sim | sim | sim | sim | sim | sim | — | sim | feita na leva 4B; a lista não tem seletor para editar no contexto |
| `/colaboradores/[id]/editar` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/colaboradores/novo` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/equipes` | sim | sim | sim | sim | sim | — | — | sim | feita na leva 4B; continua em cartões (nunca foi tabela) e não tem seletor de cadastro |
| `/equipes/[id]/editar` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 4B |
| `/equipes/app-colaborador` | — | — | sim | sim | sim | — | — | sim | feita na leva 4B; conferida no celular |
| `/equipes/montador` | — | — | sim | sim | sim | — | — | sim | feita na leva 4B; conferida no celular |
| `/equipes/novo` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 4B |
| `/veiculos` | sim | sim | sim | sim | sim | — | — | sim | feita na leva 4B; a lista não tem seletor de cadastro |
| `/veiculos/[id]/editar` | sim | — | sim | sim | sim | sim | sim | sim | feita na leva 4B; a aba Checklists é a lista padrão dos preenchidos |
| `/veiculos/checklist` | sim | — | sim | sim | sim | — | — | sim | feita na leva 4B (Preencher e Preenchidos); veículo e modelo não têm cadastro rápido (CRLV e editor de itens) |
| `/veiculos/novo` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 4B |

### Desempenho (6)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/desempenho` | — | — | — | — | — | — | — | — | toast; ajuda no ⓘ; botões por permissão; versão de celular |
| `/desempenho/colaborador/[id]` | — | — | — | — | — | — | — | — | tabela própria; toast; ajuda no ⓘ; botões por permissão; versão de celular |
| `/desempenho/configuracao` | — | — | — | — | — | — | — | — | toast; ajuda no ⓘ; botões por permissão; cadastro inline nos seletores; versão de celular |
| `/desempenho/fechamento` | — | — | — | — | — | — | — | sim | tabela própria; toast; ajuda no ⓘ; botões por permissão |
| `/desempenho/premiacoes` | — | — | — | — | — | — | — | — | toast; ajuda no ⓘ; botões por permissão; cadastro inline nos seletores; versão de celular |
| `/desempenho/revisao` | — | — | — | — | — | — | — | — | toast; ajuda no ⓘ; botões por permissão; cadastro inline nos seletores; versão de celular |

### Geral (2)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` | — | — | — | — | sim | — | — | sim | toast; ajuda no ⓘ |
| `/perfil` | — | — | — | sim | — | — | — | — | ajuda no ⓘ; botões por permissão; versão de celular |

## Como atualizar

A varredura é um script descartável; o que vale daqui para a frente é a conferência de cada leva. Ao
fechar uma leva, a tabela do módulo dela é revista à mão neste documento.
