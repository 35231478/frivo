# Cliente — aba Atendimento (histórico de OS) e Anexos por último

Dois ajustes na ficha do cliente, sem mudança de schema.

## Nova aba "Atendimento"

Entre **Dados gerais** e **Comunicação**, uma aba **Atendimento** mostra o **histórico de ordens de
serviço** do cliente, com **link para cada OS** (`/ordens/{id}`). Cada item traz o número, o selo de
status (Em Andamento, Concluída, Aguardando Peça…), a prioridade, a descrição, a data (aberta ou
concluída), a unidade e o responsável. No topo, um atalho **Nova OS**
(`/ordens/nova?clienteId={id}`); quando não há nenhuma, uma mensagem vazia com o mesmo atalho.

- Componente `components/forms/atendimento-cliente.tsx`: busca `GET /api/ordens?clienteId={id}`
  (rota já existente) **só quando a aba abre** (prop `ativo`), no padrão das abas Comunicação/Portal.
- **Filtros (padrão da casa):** um seletor de **período** (`BarraPeriodo`, rótulo "Abertura" — Hoje,
  Esta semana, Este mês, Este ano, Últimos 30 dias, Últimos 12 meses, Todo o período, Período
  personalizado) e uma **caixa de busca** (`CampoBusca`) por número, descrição, unidade, responsável
  e status. Ambos filtram em memória a lista já carregada; o contador mostra "N de M (filtro
  aplicado)" e, sem resultado, uma mensagem clara. Padrão: "Todo o período".
- No cliente **novo** (ainda sem id), a aba mostra "Salve o cliente para ver o histórico de
  atendimento".

## Ordem das abas

**Anexos** passou a ser a **última** aba. A ordem agora é: Dados gerais, Atendimento, Comunicação,
Portal, Relacionamento, Anexos.

## Consulta de CNPJ (ajuste junto)

A consulta de CNPJ **não cria mais um endereço** automaticamente — ela preenche razão social, nome
fantasia e um contato; o endereço fica no controle manual do usuário (função pura
`mesclarEnderecoPrincipal` removida junto). A consulta segue silenciosa (sem toast/linha/dica) e só
mostra **erros**.

## Testes

- `cliente-atendimento-ui`: a aba Atendimento lista as OS do cliente com link para cada uma
  (`/ordens/{id}`); a busca filtra a lista (contador "1 de 2"); vazio mostra a mensagem + atalho
  Nova OS.
- `cliente-abas-enxugar-ui`: as abas são exatamente Dados gerais, Atendimento, Comunicação, Portal,
  Relacionamento, Anexos — com **Anexos por último**.
- `cliente-cnpj-autofill-ui` / `autofill-cnpj`: a consulta preenche razão social e contato, **sem**
  criar endereço.

## Prints

Em `docs/prints/cliente-atendimento/` (desktop e celular): a barra de abas na nova ordem e a aba
Atendimento com o histórico de OS.
