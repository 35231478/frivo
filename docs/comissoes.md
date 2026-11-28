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
- A troca **segue** para a OS gerada e para as faturas (medições) que têm itens do orçamento. Ela é recusada
  (409) quando o orçamento **já tem comissão liberada**: aí o dinheiro já está na conta de alguém.
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
| Por data de emissão (aprovação do orçamento) | Na aprovação |
| Na conclusão da OS | A OS gerada do orçamento fica concluída |

O gatilho e o valor ficam **congelados** em cada comissão: trocar a regra ou o gatilho não mexe no passado.

### Ver o mês por data de emissão ou por data de recebimento

No fechamento do mês, a seção **Comissões do mês** mostra o mesmo mês pelas duas datas (abas). Abre na data da
configuração acima. É só a vista: o que o fechamento paga segue o "quando é devida".

- **Por data de emissão:** as vendas emitidas (orçamento aprovado) no mês, ainda vivas, com a comissão inteira.
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
  pessoa** com o total (bônus + comissão), com vencimento no dia 5 do mês seguinte.
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
- `tests/unit/comissoes-ui.test.ts`: as telas (vendedor, Configurações › Comissões, Meu perfil, folha do mês).
- `tests/unit/comissoes-app.test.ts`: a seção Minhas comissões no Perfil do app do técnico.
- `tests/unit/sql-comissoes.test.ts`: o SQL sobre o banco de hoje (backfill, travas, idempotência, igual ao Prisma).

Prints: `docs/prints/com1` (antes e depois, desktop e celular, dados fictícios).
