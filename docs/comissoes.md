# Comissões do vendedor (COM-1)

Comissão sobre a **venda** (orçamento aprovado), paga no **fechamento do mês** do Desempenho, junto com o
bônus de qualidade. Nesta leva só o papel **Vendedor** gera comissão; o modelo já tem **Executor** e
**Responsável** para a COM-2 (técnico por item, ao vivo no app).

Empresa **sem regra ativa** não vê nada de comissão: nem a aba em Meu perfil, nem as colunas da folha.

## O vendedor

- Coluna própria `orcamentos.vendedor_id` (FK usuário). Nasce = **quem criou** (o usuário logado; no lead do
  site, o mesmo `criado_por` que o lead já usa). Fica **travado** na tela (cadeado).
- **Trocar** só com a permissão nova Orçamentos › **"Trocar vendedor"** (ADMIN sempre tem; nenhum perfil
  existente foi alterado). Pede a pessoa e o **motivo** (mínimo 5 letras), que vai para a linha do tempo do
  orçamento ("Vendedor: A → B. Motivo: …").
- A troca **segue** para a OS gerada e para as faturas (medições) que têm itens do orçamento.
- **Troca depois de liberar (COM-1.1).** A troca vale, com o motivo, e tudo acontece na **mesma transação**:
  - o que foi liberado para o vendedor antigo é **estornado** (motivo "Troca de vendedor");
  - a comissão dele fica como **substituída** (`papel = VENDEDOR_ANTERIOR`), só como histórico: vale 0, sai do
    relatório e do extrato dele (fica só o que já foi pago);
  - o novo vendedor ganha a comissão dele (as regras de hoje, o mesmo "quando" da venda), já liberada no que for
    devido.

  Se algo da comissão **já foi pago** (está num fechamento fechado), a troca é recusada (409) com o mês:
  "A comissão desta venda já foi paga no fechamento de MM/AAAA…". Comissão sem nada liberado é simplesmente refeita
  para o novo vendedor, como antes.
- Backfill (no SQL): `vendedor_id = criado_por_id` nos orçamentos existentes. OS antigas mostram o vendedor do
  orçamento de origem (sem backfill nelas).
- Coluna opcional **"Vendedor"** nas listas de orçamentos e de OS (seletor de colunas; escondida por padrão).

## As regras (Configurações › Comercial › Comissões)

Uma regra por linha: **Quem** · **Papel** · **Sobre** · **Base** · **Valor**.

| Campo | Opções |
|---|---|
| Quem | Pessoa · Cargo · Todos |
| Papel | Vendedor (Executor e Responsável aparecem como "em breve") |
| Sobre | Todos os serviços · Categoria de serviço · Um serviço · Peças |
| Base | % da venda · % do lucro · Valor fixo por item |

**O item manda, a pessoa desempata** (como a "comissão diferenciada" do OMIE, que tem prioridade sobre a fixa).
Item a item, a primeira que casar vence:

1. pessoa + um serviço
2. cargo + um serviço
3. pessoa + categoria
4. cargo + categoria
5. pessoa + todos os serviços (o "fixo" da pessoa)
6. cargo + todos os serviços

"Todos" fecha cada nível (ex.: "Todos + um serviço" vem logo depois de "cargo + um serviço" e vence o fixo da
pessoa). Exemplo da tela: Ana tem 7% fixo; no item Instalação VRF vale a regra do serviço (3%).

Duas regras ativas para a mesma pessoa/cargo e o mesmo alvo são recusadas (409). Regra não se apaga: **desativa**
(o passado guarda qual regra valeu). A categoria compara sem maiúscula e sem acento.

- **Categoria de serviço** é um campo novo no cadastro do serviço (`servicos.categoria`, texto livre).
- **Cargo**: o cargo do colaborador ligado ao usuário (pelo e-mail de acesso ao app). Usuário sem colaborador
  só casa com regras de **Pessoa** ou **Todos**.
- **% do lucro** = venda líquida − custo (materiais incluídos no serviço; peça pelo custo do material ou o
  último custo de compra). É calculado **só no servidor**; o vendedor nunca vê custo, margem nem a base em reais.
  Custo desconhecido → comissão 0 nesse item (mão de obra não tem custo).

### A base

- Sobre o valor **com desconto** (o desconto de serviços/peças é rateado pelas linhas).
- Padrão: valor **com o ISS** (o que o cliente paga). Opção da empresa **"Base líquida de impostos"**: sem o ISS.

## Quando fica devida (configuração da empresa)

| Gatilho | Liberada quando |
|---|---|
| **Por data de recebimento** (padrão) | Proporcional ao que entrou: parcela paga → comissão proporcional |
| Na aprovação do orçamento | Na aprovação |
| Na conclusão da OS | A OS gerada do orçamento fica concluída |

(O gatilho "na aprovação" se chamava "Por data de emissão". Com a COM-1.1, **emissão** passou a ser a da fatura;
o nome mudou para não confundir. O gatilho em si não mudou.)

O gatilho e o valor ficam **congelados** em cada comissão: trocar a regra ou o gatilho não mexe no passado.

### Ver o mês por data de emissão ou por data de recebimento

No fechamento do mês, a seção **Comissões do mês** mostra o mesmo mês pelas duas datas (abas). Abre na data da
configuração acima. É só a vista: o que o fechamento paga segue o "quando é devida".

- **Por data de emissão (COM-1.1, como no OMIE):** a data é a da **emissão da fatura/NF**, não a aprovação. Vale a
  primeira que existir:
  1. a NFS-e autorizada (a mais antiga);
  2. a NF registrada na fatura;
  3. a fatura enviada ao cliente;
  4. o primeiro título gerado.

  Entra a parte de cada fatura **viva** da venda emitida no mês (o que ela cobra da venda ÷ o total da venda).
  A **venda sem fatura emitida não aparece** nesta vista (rascunho não conta). Faturar a mais não gera comissão a mais.
- **Por data de recebimento:** a parte de cada comissão coberta pelo dinheiro que entrou no mês, recebimento a
  recebimento (o recebido de cada fatura × a parte da venda nela). Recebido antes não conta de novo; o que passar
  do total da venda não gera comissão a mais.

Por pessoa, com as vendas de cada uma ao abrir. Rota: `GET /api/comissoes/relatorio?mes=AAAA-MM&vista=EMISSAO|RECEBIMENTO`
(Desempenho › Gerenciar, como o fechamento).

**Um vendedor por orçamento/OS** (como no OMIE). Dividir a venda entre dois vendedores fica para depois.

## Os estados

Cada item gera uma comissão (`comissoes`, valor congelado). O que acontece com ela vira **lançamentos**
(`comissao_lancamentos`): **Liberação** (+) ou **Estorno** (−).

- **Prevista** — orçamento aprovado, ainda não liberada.
- **Liberada** — o gatilho aconteceu; entra no próximo fechamento do mês.
- **Paga** — o lançamento está num fechamento **fechado**.

**Estorno automático**: o recálculo compara o que já foi liberado com o que é devido agora e lança a diferença.

- No recebimento: recebimento estornado ou fatura/conta cancelada → estorno.
- Na aprovação e na conclusão: orçamento cancelado/recusado, ou a OS deixou de estar concluída → estorno.
- Na aprovação e na conclusão, também a **fatura cancelada** (COM-1.1, proteção da empresa), com o motivo
  "Fatura cancelada". Conta como cancelada a medição cancelada ou a fatura com **todos** os títulos cancelados ou
  excluídos. O estorno só acontece quando **não sobrou nenhuma fatura viva**. Refaturar devolve a comissão. Venda
  ainda sem fatura não estorna.

Estorno de comissão já paga fica como saldo **negativo**, que desconta no próximo fechamento (a linha só gera
conta a pagar quando o total é positivo).

O recálculo é **idempotente** e roda quando alguém olha: a prévia e o fechamento do mês, e o extrato de
Minhas comissões. Ele trava a empresa enquanto conta (dois recálculos ao mesmo tempo não liberam duas vezes).
Nenhum código de pagamento, recebimento ou fatura foi alterado para isso.

## Pagamento: o fechamento do mês

Sem tela nova. A folha do mês ganha as colunas **Comissão** e **Total** (só quando a empresa usa comissão).

- Quem tem bônus e comissão fica numa linha só; quem só tem comissão entra no fim, com o perfil "Comissão".
- Empresa sem programa de bônus usa o mesmo fechamento, só com as comissões.
- **Fechar** liga os lançamentos liberados até o fim do mês ao fechamento e gera **uma conta a pagar por
  pessoa** com o total (bônus + comissão).
- **Vencimento (COM-1.1):** configurável em Configurações › Comissões › "Vencimento do pagamento":
  - **dia útil do mês seguinte** (1º a 20º, segunda a sexta; feriados não entram, pois não há cadastro de
    feriados);
  - ou **dia fixo do mês seguinte** (1 a 31; além do fim do mês, vale o último dia).

  O padrão é o **5º dia útil**. Se a data já passou quando o mês é fechado, vence no dia. Mudar vale para o
  próximo fechamento. (Antes: dia 5 fixo.)
- **Reabrir** é recusado se alguma dessas contas já tem pagamento. Sem pagamento, as contas são canceladas e as
  comissões voltam a "liberada".
- O CSV da folha ganha "Comissão (R$)" e "Total (R$)" quando há comissão.

## Minhas comissões

Em **Meu perfil › Comissões** no painel e, no app do técnico, na seção **Minhas comissões** do Perfil (fechada
até tocar: o extrato recalcula, então só carrega quando abre). As duas só aparecem quando a empresa usa
comissão. Mostra o extrato da própria pessoa: totais prevista/liberada/paga e a lista por orçamento/OS, com o item e a regra que valeu. Só valores
de comissão.

## Permissões

| O quê | Permissão | No servidor |
|---|---|---|
| Trocar o vendedor | Orçamentos › Trocar vendedor (nova) | `PATCH /api/orcamentos/[id]/vendedor` |
| Regras e configuração | Desempenho › Gerenciar | `GET/PUT /api/comissoes`, `POST /api/comissoes/regras`, `PATCH /api/comissoes/regras/[id]` |
| Fechar e reabrir o mês | as do fechamento do Desempenho (sem mudança) | `/api/desempenho/fechamentos` |
| Minhas comissões | só estar logado (vê só as próprias) | `GET /api/perfil/comissoes` |

Tudo filtrado pela empresa da sessão; referências (pessoa, cargo, serviço) de outra empresa são recusadas.

## Ver só os próprios (Orçamentos e OS)

Marca nova nos perfis de acesso, em **Orçamentos** e em **Ordens de serviço**: "Ver só os próprios". Ao contrário
das outras marcas, ela **limita**:

- **Orçamentos:** só aqueles em que a pessoa é o **vendedor**.
- **OS:** só as ligadas a eles. Entra a OS cujo vendedor é a pessoa, a OS de um orçamento dela (orçamento de origem)
  e a OS que ela criou.

O filtro é do **servidor**, em todos estes pontos:
- listas e contagens de orçamentos, OS, leads e solicitações;
- busca;
- exportação de OS;
- seleção e ações em massa (ids do filtro, exportar, inativar);
- painel (blocos de OS e comercial);
- sino e painel de pendências;
- calendário;
- relatório de cumprimento de prazos;
- histórico do equipamento;
- assistente;
- **toda rota da API por id** (`/api/orcamentos/[id]/…` e `/api/ordens/[id]/…`, inclusive as que gravam), mais
  os prazos da OS;
- o **pedido do cliente** (`/api/pedidos-cliente/…`):
  - informar o pedido e liberar sem pedido: qualquer OS/orçamento de outro vendedor na lista dá 404;
  - a gaveta (o que o pedido vai cobrir) mostra só os da pessoa;
  - **pedido compartilhado** (cobre OS de dois vendedores, COM-1.1): cada vendedor **vê** o pedido e o anexo
    com as OS/orçamentos dele (só esses aparecem, e o total é só deles). **Corrigir e conferir** continua só para
    quem não tem a marca (ou para quem tem tudo o que o pedido cobre). A gaveta mostra o pedido só para leitura,
    com o aviso. Pedido sem nada da pessoa dá 404;
  - **pela fatura** que cobre OS dos dois: com a marca, o pedido informado liga só as OS/orçamentos da pessoa. O
    outro vendedor informa o dele nas OS dele, e a fatura segue "Aguardando PC" enquanto alguma OS dela esperar o
    pedido. Fatura sem nada da pessoa dá 404;
  - as contagens de OS aguardando pedido no painel e no sino.

Abrir por link direto um registro de outro vendedor dá **404** (página: "não encontrado").

- **ADMIN nunca é limitado** (nem com a marca ligada).
- A marca fica fora de "todas as permissões": o perfil Administrador e o "Selecionar tudo" do editor não a ligam.
- **Nenhum perfil existente foi alterado** (nenhum UPDATE).
- O perfil "Vendas" das **empresas novas** nasce com a marca em Orçamentos e em OS e, desde a COM-1.1, com
  **"Visualizar" em OS**: o vendedor vê as OS dele, sem criar, editar nem excluir. Os perfis de empresas que já
  existem não mudam.
- **Lista de clientes (COM-1.1):** com a marca em OS, a contagem de OS de cada cliente é só a das OS da pessoa, e
  ordenar pela coluna OS volta à ordem padrão. Nada revela o volume dos outros.
- A exportação de dados da empresa é só do ADMIN, por isso não muda.

Código: `lib/escopo/proprios.ts` (regra) e `lib/escopo/proprios-server.ts` (guarda por id, ids em massa).
Testes:
- `tests/unit/escopo-proprios-pg.test.ts`: vazamento entre vendedores no PostgreSQL real, incluindo a **varredura**
  de todas as rotas por id. Rota nova sem o guarda quebra o teste.
- `tests/unit/escopo-proprios.test.ts`: regra e presets.
- `tests/unit/escopo-proprios-ui.test.ts`: editor de perfil.

## Banco

SQL aditivo e idempotente: `prisma/sql/2027-02-11_comissoes.sql`.

- 3 tabelas novas: `comissao_regras`, `comissoes`, `comissao_lancamentos`.
- Colunas novas:
  - `vendedor_id` em `orcamentos`, `ordens_servico` e `medicoes`;
  - `servicos.categoria`;
  - `configuracoes.comissao_quando` e `configuracoes.comissao_liquida_impostos`;
  - `desempenho_fechamentos.total_comissao`;
  - `desempenho_fechamento_linhas.usuario_id`, `.comissao` e `.conta_pagar_id`.
- O único UPDATE é o backfill do vendedor.

COM-1.1: `prisma/sql/2027-02-14_comissoes_vencimento.sql`, também aditivo e idempotente:
- `configuracoes.comissao_vencimento_tipo` (`DIA_UTIL` | `DIA_FIXO`, padrão `DIA_UTIL`);
- `configuracoes.comissao_vencimento_dia` (padrão 5);
- CHECK dos limites.

Nada é reescrito. A troca de vendedor usa o `papel` que já existe (`VENDEDOR_ANTERIOR`), sem coluna nova.

## Testes

- `tests/unit/comissoes.test.ts`: regras puras (precedência, base, recebimento proporcional, estados, validação).
- `tests/unit/comissoes-pg.test.ts`: PostgreSQL real, de ponta a ponta. Cobre:
  - congelamento;
  - recebimento parcial e estorno;
  - os três gatilhos;
  - fechamento e conta a pagar;
  - reabrir;
  - permissões;
  - isolamento entre empresas;
  - empresa sem regra.
- `tests/unit/comissoes-ui.test.ts`: as telas (vendedor, Configurações › Comissões com o vencimento, Meu perfil, folha do mês).
- `tests/unit/com11-regras.test.ts`: regras puras da COM-1.1:
  - fatura cancelada;
  - data de emissão e vista por emissão;
  - vencimento;
  - ordem da lista de clientes.

  O `comissoes-pg` cobre ainda o estorno por fatura/título cancelado, a emissão pela NF, a troca depois de
  liberar (e a recusa quando paga) e o vencimento do fechamento. O `escopo-proprios-pg` cobre o pedido
  compartilhado e a contagem de OS no escopo.
- `tests/unit/comissoes-app.test.ts`: a seção Minhas comissões no Perfil do app do técnico.
- `tests/unit/sql-comissoes.test.ts`: o SQL sobre o banco de hoje (backfill, travas, idempotência, igual ao Prisma).

Prints: `docs/prints/com1` (antes e depois, desktop e celular, dados fictícios).
