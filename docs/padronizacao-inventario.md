# Padronização de telas — inventário e plano de levas

Inventário das telas do painel contra o checklist da padronização, para planejar as levas por módulo.
Feito em 14/11/2026, com o código da leva 2; a tabela de Configurações e o placar foram revistos na leva 3,
e as de Clientes e de Equipamentos e QR Codes na leva 4A.

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

## Próximas levas (ordem sugerida)

Um PR por leva, cada um com 🟢 (sem banco) ou 🔵 (com SQL). A ordem vai do que mais atrapalha o uso
diário para o que menos atrapalha, e do menor para o maior.

| Leva | Módulo | Telas | Por que nesta ordem |
|---|---|---|---|
| 4B | **Cadastros principais (2ª parte)** | Veículos (lista, formulários, checklist), colaboradores, equipes | A 1ª parte (clientes, equipamentos, QR Codes) é a leva 4A. Falta: detalhe, editar e inativar do checklist de veículo; cadastro rápido do responsável técnico; reativar formulário e modelo de checklist inativados |
| 5 | **Operação** | Lista de OS, calendário, prazos, execução da atividade, PMOC | Onde o escritório passa o dia. PMOC é planilha: padroniza, não joga fora |
| 6 | **Comercial** | Lista de orçamentos, contratos (lista, formulário, reajustes, relatório), leads do site | O formulário de contrato tem 12 seletores e tabela própria |
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
| `/calendario` | — | — | — | sim | sim | — | — | sim | ajuda no ⓘ; cadastro inline nos seletores |
| `/mapa` | — | — | — | — | sim | — | — | — | toast; ajuda no ⓘ; versão de celular |
| `/ordens` | sim | sim | sim | — | sim | sim | — | sim | toast; edição no contexto |
| `/ordens/[id]` | — | — | sim | sim | sim | sim | sim | sim | feita na leva 2: referência × uso nos itens; as linhas travam com a OS assinada pelo cliente, faturada ou com nota (só concluída continua editável) |
| `/ordens/[id]/atividades/[atividadeId]/executar` | — | — | — | sim | sim | — | — | — | ajuda no ⓘ; cadastro inline nos seletores; versão de celular |
| `/ordens/nova` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/prazos` | — | sim | — | — | — | — | — | — | toast; ajuda no ⓘ; botões por permissão; cadastro inline nos seletores; versão de celular |

### PMOC (3)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/pmoc` | — | — | sim | sim | sim | — | — | sim | tabela própria; cadastro inline nos seletores |
| `/pmoc/[id]` | — | — | sim | sim | sim | sim | — | sim | tabela própria; edição no contexto |
| `/pmoc/novo` | — | — | sim | sim | sim | sim | — | sim | tabela própria; edição no contexto |

### Comercial: orçamentos, contratos e leads (10)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/contratos` | sim | sim | sim | — | sim | sim | — | sim | tabela própria; toast; edição no contexto |
| `/contratos/[id]/editar` | — | — | sim | sim | sim | sim | sim | sim | tabela própria |
| `/contratos/novo` | — | — | sim | sim | sim | sim | sim | sim | tabela própria |
| `/contratos/reajustes` | — | — | sim | sim | sim | — | — | sim | tabela própria |
| `/contratos/relatorio` | — | — | — | sim | — | — | — | sim | ajuda no ⓘ; botões por permissão; cadastro inline nos seletores |
| `/leads-site` | — | sim | — | — | sim | — | — | — | tabela própria; toast; ajuda no ⓘ; versão de celular |
| `/orcamentos` | — | sim | sim | sim | sim | sim | — | sim | edição no contexto |
| `/orcamentos/[id]` | — | — | sim | sim | sim | sim | sim | sim | tabela própria |
| `/orcamentos/[id]/editar` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/orcamentos/novo` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |

### Estoque e compras (11)

| Tela | Lista no padrão | Busca e página no servidor | Ajuda no ⓘ | Toast | Botões por permissão | Cadastro inline | Edição no contexto | Celular | O que a varredura não viu |
|---|---|---|---|---|---|---|---|---|---|
| `/compras/pedidos` | — | sim | — | sim | sim | sim | — | sim | tabela própria; ajuda no ⓘ; edição no contexto |
| `/compras/pedidos/[id]` | — | — | — | sim | sim | sim | — | sim | tabela própria; ajuda no ⓘ; edição no contexto |
| `/compras/pedidos/novo` | — | — | — | sim | sim | sim | — | sim | ajuda no ⓘ; edição no contexto |
| `/estoque` | — | — | sim | — | sim | — | — | sim | toast |
| `/estoque/[produtoId]` | — | — | sim | sim | sim | — | — | sim | nada apontado pela varredura |
| `/estoque/devolucao` | — | — | sim | — | sim | — | — | sim | tabela própria; toast |
| `/estoque/devolucao/[osId]` | — | — | sim | sim | sim | — | — | sim | nada apontado pela varredura |
| `/estoque/notas` | — | sim | — | — | sim | — | — | sim | tabela própria; toast; ajuda no ⓘ |
| `/estoque/notas/[id]` | — | — | — | sim | sim | sim | sim | sim | ajuda no ⓘ |
| `/estoque/separacao` | — | — | sim | — | sim | — | — | sim | tabela própria; toast |
| `/estoque/separacao/[osId]` | — | — | sim | sim | sim | — | — | sim | tabela própria |

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
| `/colaboradores` | — | — | sim | — | sim | sim | — | sim | toast; edição no contexto |
| `/colaboradores/[id]/editar` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/colaboradores/novo` | — | — | sim | sim | sim | sim | sim | sim | nada apontado pela varredura |
| `/equipes` | sim | sim | — | — | sim | — | — | sim | toast; ajuda no ⓘ; cadastro inline nos seletores |
| `/equipes/[id]/editar` | — | — | — | — | sim | — | — | sim | toast; ajuda no ⓘ; cadastro inline nos seletores |
| `/equipes/app-colaborador` | — | — | sim | — | sim | — | — | — | toast; versão de celular |
| `/equipes/montador` | — | — | — | — | sim | — | — | — | toast; ajuda no ⓘ; versão de celular |
| `/equipes/novo` | — | — | — | — | sim | — | — | sim | toast; ajuda no ⓘ; cadastro inline nos seletores |
| `/veiculos` | — | — | sim | — | sim | sim | — | sim | toast; edição no contexto |
| `/veiculos/[id]/editar` | — | — | sim | — | sim | — | — | sim | tabela própria; toast; cadastro inline nos seletores |
| `/veiculos/checklist` | — | — | — | — | — | — | — | sim | toast; ajuda no ⓘ; botões por permissão; cadastro inline nos seletores |
| `/veiculos/novo` | — | — | sim | — | sim | — | — | sim | tabela própria; toast; cadastro inline nos seletores |

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
