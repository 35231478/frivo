# Cliente — enxugar abas (de 9 para 5)

A ficha do cliente tinha 9 abas (Dados gerais, Contatos, Endereços, Comunicação, Faturamento,
Contratos, Portal, Anexos e mídia, Relacionamento). Agora são **5**: **Dados gerais, Comunicação,
Anexos, Portal, Relacionamento**. Sem mudança de schema (as colunas ficam; só a UI muda).

## O que mudou

- **Dados gerais** concentra, em seções com cabeçalho (o `FormSection` padrão, em maiúsculas com
  ícone), nesta ordem: **Dados básicos** → **Logomarca** (antes em "Anexos e mídia", agora no topo,
  junto aos dados básicos) → **Contatos do cliente** (lista com adicionar/editar/excluir, íntegra) →
  **Endereços do cliente** (lista com adicionar/editar/excluir/definir principal, íntegra) →
  **Tabela de preços** (antes na aba Faturamento).
- **Contatos** e **Endereços** deixam de ser abas (migraram para Dados gerais, com todas as ações).
- **Anexos e mídia** vira só **Anexos** (a logo foi para Dados gerais; sobra só o anexo de arquivos).
- **Faturamento** (aba inteira) sai: a tabela de preços migrou; **tipo de faturamento**, **dia de
  faturamento** e **condição de pagamento** saem da interface (não vamos usar).
- **Contratos** sai do cadastro do cliente. A configuração de contrato vive em cada contrato
  (Comercial › Contratos); a badge do cabeçalho vira um link para os contratos do cliente
  (`/contratos?clienteId=…`).

## Pontas soltas resolvidas

- **A) Schema intocado.** Os três campos (`tipoFaturamento`, `diaFaturamento`, `condicaoPagamento`)
  e os canais de cobrança (`whatsappFaturamento`, `emailsFaturamento`, `exigePcAntesNf`,
  `agrupaAdicionais`, `boletoUnicoMensal`) **continuam no banco**. Para a edição não zerá-los, eles
  **saíram do `clienteSchema`** (lib/validations.ts): o `PUT` do cliente não toca mais nessas
  colunas, então os valores existentes são preservados.
- **B) Faturamento recorrente.** A rotina de faturamento de contratos já lê o **dia** do
  **contrato** (`contrato.diaFaturamento` → `diaFixoMes` → `diaVencimento`, com o do cliente só como
  *fallback* — `lib/financeiro/contrato-previsao.ts`). O recorrente **não perde a fonte de
  configuração**: segue lendo do contrato, e o `cliente.diaFaturamento` (coluna mantida) continua
  valendo como fallback. Nenhuma lógica de faturamento precisou mudar.
- **C) Contrato tem config própria.** O formulário de contrato (Comercial › Contratos) já tem **dia
  de faturamento**, periodicidade e regra de vencimento próprios. `tipo de faturamento` (perfil:
  fatura única / com aprovação) é um campo **só do cliente**, lido pela montagem da medição (status e
  fatura única); como não vamos mais usá-lo e criá-lo no contrato seria mudança de schema, ele foi
  **removido da UI mantendo a coluna** (decisão confirmada): clientes atuais seguem faturando igual;
  cliente novo nasce no fluxo padrão. A conversão de orçamento→contrato ainda grava o perfil no
  cliente (`app/api/orcamentos/[id]/gerar-contrato`), então esse caminho segue funcionando.
- **D) Logo preservada.** O upload da logo (`LogoUpload`) só mudou de aba; usa o mesmo `clienteId` e
  `logoInicial={cliente.logo}`. Clientes com logo salva continuam exibindo normalmente.
- **E) Responsividade.** Dados gerais ficou mais longo; as seções usam o espaçamento padrão
  (`space-y-8`) e empilham bem no celular (ver prints).

## Testes

- `cliente-abas-enxugar-ui` (DOM): as abas são exatamente as 5; Contatos/Endereços/Faturamento/
  Contratos saíram; Dados gerais tem as seções básicos/logo/contatos/endereços/tabela (pelo
  `<h3>`); o perfil de faturamento (tipo/dia/condição) não aparece mais; a badge de contratos é um
  link para `/contratos?clienteId=`.
- Rodada de mutação (4/4 mortas): volta da aba Faturamento, sumiço da seção Tabela de preços, badge
  virar botão, e tipo de faturamento voltar à UI.
- `ux2-cliente`, `tabela-preco-seletor-ui` e o ratchet seguem verdes; a suíte completa (PG real) roda.

## Prints

Em `docs/prints/cliente-abas/` (desktop e celular): as 5 abas, Dados gerais com Logo/Contatos no topo
e Endereços/Tabela de preços abaixo.
