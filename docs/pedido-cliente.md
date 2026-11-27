# Pedido do cliente (PC-1)

Clientes corporativos (e os do Sistema S) só pagam com o **pedido de compra deles**. A empresa orça e executa antes, conclui e fica esperando o pedido para emitir a NF; sem controle, os pendentes se perdiam.

**Vocabulário.** "Pedido do cliente" é o pedido que o CLIENTE emite. Não confundir com o "Pedido de compra" do fornecedor (módulo Compras). A etiqueta é **"Aguardando pedido"**.

**Nenhuma tela nova.** Tudo entra nas telas que já existem, com o mínimo de cliques.

> 🔵 **Banco — NÃO aplicado.** O SQL está em `prisma/sql/2027-02-11_pedido_cliente.sql`. Ele é aditivo e idempotente:
> - 4 colunas no cliente, 1 na unidade e 1 em configurações;
> - a tabela nova `pedidos_cliente`;
> - o pedido e a liberação na OS e no orçamento.
>
> Nenhuma linha muda e nenhum perfil de acesso é alterado. Aplicar no Neon antes do merge.

## 1. Quem exige (ficha do cliente e unidade)

Na ficha do cliente, em **Cobrança e faturamento**, o campo **Exige pedido do cliente** tem três opções:

| Opção | O que acontece |
|---|---|
| **Não** (padrão) | nada muda |
| **Para faturar** | a OS é executada normalmente; a fatura e a NFS-e esperam o pedido |
| **Para executar e faturar** | nem a execução começa sem o pedido; a fatura e a NFS-e também esperam |

**"Para faturar" é o antigo interruptor** "Exige pedido de compra antes da NF" (`clientes.exige_pc_antes_nf`). Quem já estava marcado continua valendo, sem SQL de atualização. "Para executar" é a coluna nova `exige_pedido_executar`.

**Contato de compras.** Nome, e-mail e telefone de quem emite o pedido. Aparece quando o cliente exige e é mostrado na gaveta do pedido.

**Unidade.** Cada unidade pode ter a regra dela (ex.: uma filial que paga com o pedido próprio). O padrão é **Como o cliente**.

**Empresa sem nenhum cliente nem unidade marcados** (`usaPedidoCliente`): não vê nada disto. Não há etiqueta, filtro, ação em massa, linha no painel nem sino.

## 2. A pendência automática: "Aguardando pedido"

A OS e o orçamento aprovado de um cliente (ou unidade) que exige **nascem "Aguardando pedido"**. A regra é uma só, em `lib/pedido-cliente/regra.ts` › `aguardandoPedido`; os `where` equivalentes ficam em `lib/pedido-cliente/where.ts`.

A pendência sai quando acontece qualquer um destes:
- informaram o pedido;
- liberaram sem pedido;
- a OS foi cancelada;
- a fatura já saiu: NF emitida, ou o PC registrado na fatura do jeito antigo.

**Onde a etiqueta aparece:**
- no cabeçalho da OS e do orçamento;
- nas linhas das listas de OS, Orçamentos e Faturas (medições);
- na aba Financeiro da OS, ao lado do "Faturar";
- no "A faturar" do fluxo de caixa;
- em Contas a receber, quando a fatura da conta espera o pedido.

Depois de informado, vira **"Pedido nº X"** (1 clique abre para ver ou corrigir). Liberado, vira **"Liberado sem pedido"**, com o motivo no tooltip.

## 3. Informar o pedido

**Um clique na etiqueta** abre uma gaveta pequena (`components/pedido-cliente/gaveta-pedido.tsx`) com:
- número (obrigatório);
- data (hoje em Brasília);
- valor;
- anexo (PDF ou foto, até 5 MB, com o tipo conferido pelo conteúdo);
- observação.

**Um pedido cobre várias OS e orçamentos** do mesmo cliente. A gaveta mostra o que ele cobre e o total.

**Em massa.** Nas listas de OS e de Orçamentos, selecione várias e use **Informar pedido do cliente** na barra de ações. Itens de clientes diferentes: a gaveta avisa e não deixa salvar.

**Alerta, não trava.** Se o valor do pedido for menor que o total do que ele cobre, a gaveta avisa ao vivo e o aviso volta depois de salvar.

**A propagação** (`lib/pedido-cliente/server.ts` › `registrarPedido`):
- o pedido do orçamento vale para a OS gerada dele, e vice-versa;
- a OS gerada depois herda o pedido ou a liberação.

**Na fatura** (medição), o antigo "Registrar PC recebido" virou **Informar pedido do cliente** e abre a mesma gaveta. O pedido fica nas OS e orçamentos da fatura, e a fatura que estava "Aguardando pedido" segue sozinha para a nota.

**Rótulos da fatura.** "Aguardando PC" virou **"Aguardando pedido"** e "PC recebido" virou **"Pedido recebido"**.

**Histórico.** "Pedido do cliente informado / corrigido" fica no histórico da OS e na linha do tempo do orçamento.

## 4. A trava e a liberação

**Fatura.** Sem o pedido, o "Faturar" da OS e do orçamento recusa com o motivo. A fatura que nasce da aprovação ou do relatório vai para **"Aguardando pedido"** se alguma OS dela espera.

**NFS-e.** Só sai de fatura liberada (`STATUS_MEDICAO_EMITE`), então a fatura "Aguardando pedido" não emite. A emissão (`lib/nfse/*`) não foi tocada: há uma guarda que exige que esses arquivos fiquem iguais.

**Execução** (só no modo "para executar e faturar"):
- o **"Cheguei"** e o **iniciar** no app recusam com o motivo;
- o escritório também não consegue pôr a atividade nem a OS em andamento;
- o cartão do "Meu dia" avisa antes do toque.

**Liberar sem pedido.** É uma permissão nova: **Ordens de serviço › Liberar sem pedido do cliente**.
- Nenhum perfil existente foi alterado (nenhum UPDATE); o administrador tem sempre.
- O motivo é obrigatório (5 a 300 caracteres) e vai para a trilha da OS e do orçamento.

## 5. O número na NFS-e

O número do pedido entra **sozinho** na discriminação: "Ref.: Fatura nº 2026-0031 · OS OS-2026-0401 · Pedido do cliente nº 4500012345".

Ele vem do `pcNumero` da fatura, por `lib/faturamento/fatura.ts` › `referenciaNota`. O `pcNumero` é preenchido:
- ao faturar;
- ao aprovar;
- ao informar o pedido das OS de uma fatura ainda não emitida.

## 6. Filtro rápido, painel e sino

**Filtro rápido "Aguardando pedido".** Fica na barra de filtros compartilhada (`BarraFiltros` › `rapidos`) das listas de OS, Orçamentos e Faturas.
- Mostra a contagem e o total em R$ dentro dos outros filtros.
- Liga e desliga pela URL (`?pedido=aguardando`); "Limpar filtros" também tira.

**Painel de pendências** (`/pendencias`). A linha **"Aguardando pedido do cliente — N · R$ X"** conta todas as OS que esperam. O clique abre a lista de OS filtrada, das mais antigas para as mais novas.

**Sino.** Avisa a OS que espera **há mais de X dias**:
- contados da conclusão da OS;
- no modo "para executar", contados da aprovação.

O X fica em **Configurações › Orçamentos e propostas › Pedido do cliente** (1 a 90 dias, padrão 7). O aviso entra no número do sino, e o toque marca como lido, como os outros avisos.

## Testes

| Arquivo | O que prova |
|---|---|
| `pedido-cliente-regra` | modo do cliente e da unidade, quem aguarda, travas, alerta de valor, texto da nota, limpeza, relógio do sino |
| `pedido-cliente-ui` | gaveta (cobre, alerta ao vivo, validação, corpo enviado, clientes diferentes, liberar, corrigir, fatura), etiqueta, filtro rápido, ação em massa |
| `cliente-cobranca-ui` | o seletor de 3 opções na ficha e o contato de compras |
| `pedido-cliente-pg` (PostgreSQL real) | quem aguarda, travas (fatura, app, Cheguei, escritório), registrar (vários, outro cliente, outra empresa, anexo, histórico, alerta, corrigir), propagação orçamento ⇄ OS, liberação e permissões, fatura aprovada e Registrar PC, nº na nota, sino, lista de OS, painel, configuração |
| `sql-pedido-cliente` (PostgreSQL real) | o SQL rodado duas vezes, igual ao Prisma, nenhuma linha muda |

## Prints (dados fictícios)

Em `docs/prints/pedido-cliente/`, `antes-*` e `depois-*`, desktop e celular:
- `ficha-cliente`: o seletor de 3 opções e o contato de compras;
- `os-cabecalho`, `orcamento`, `fatura`: a etiqueta no cabeçalho e o botão da fatura;
- `lista-os`, `lista-orcamentos`, `lista-faturas`: a etiqueta nas linhas e o filtro rápido com contagem e R$;
- `gaveta-pedido`: a gaveta aberta pela etiqueta, com o alerta de valor;
- `massa-pedido`: três OS selecionadas e "Informar pedido do cliente";
- `filtro-aguardando`: a lista de OS filtrada;
- `pendencias`: a linha "Aguardando pedido do cliente" com o total.
