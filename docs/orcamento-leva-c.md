# Orçamento — leva C: solicitar compra dos itens sem estoque

Anotação do Zé: "caso alguns itens não tenham em estoque, já solicitar a compra por aqui desses itens fora de estoque —
já cria o pedido de compra lá pra cotação, pra não precisar lançar um a um no pedido de compra".

Banco: **nenhum**. O vínculo já existia (`pedidos_compra_interno.orcamento_id` e `ordem_servico_id`).

## Levantamento — como o pedido de compra funciona hoje

| Peça | Como é |
|---|---|
| Modelo | `PedidoCompraInterno`: `orcamentoId` e `ordemServicoId` (origem), `solicitanteId`, `compradorId`, `fornecedorId`, `observacao`, `motivo` (só avulso), itens (`PedidoCompraItem`: produto, descrição, quantidade, unidade, `valorEstimado`, `valorReal`) e histórico (`PedidoCompraEvento`). |
| Estados | `SOLICITADO` (nasce assim) → `COTANDO` (ao baixar/enviar ao fornecedor: `statusAposEnvio`) → `PARCIAL` → `CONCLUIDO`, ou `CANCELADO`. "Encerrado" = concluído, cancelado ou entregue (`pedidoEncerrado`). |
| Criar | `POST /api/pedidos-compra`: Compras › gerenciar, ou Ordens › editar (origem OS), ou Orçamentos › editar (origem orçamento). Portão do módulo Compras. Número pelo contador da empresa. Evento "Pedido criado". |
| No orçamento | A tela do orçamento já tinha a seção **Compras** ("Solicitar compra de material", manual, um item por vez) e a lista dos pedidos do orçamento, que abrem ali mesmo. |
| Disponível | Leva B: saldo do produto (já líquido das reservas da OS); produto sem controle de estoque não tem disponível. |

## O que mudou

- **Onde:** na **tela do orçamento**, dentro da seção Compras, um painel "Itens sem estoque" com o botão
  **"Solicitar compra dos faltantes"**.
  - Não fica no Editar: o Editar só existe em rascunho e trabalha com itens ainda não salvos, enquanto o pedido de
    compra precisa do orçamento gravado. A necessidade de comprar costuma aparecer depois de enviar ou aprovar, e a
    seção Compras já é onde os pedidos do orçamento vivem.
- **O que entra:** cada produto cuja necessidade **somada no orçamento inteiro** passa do disponível.
  - A necessidade soma as linhas de produto e os materiais dos serviços. A peça derivada entra uma vez só, pelo material.
  - A quantidade pedida é o que falta: necessidade − disponível, menos o que já está pedido em pedido aberto deste
    orçamento.
- **O pedido:**
  - **um** pedido no estado inicial do fluxo (`SOLICITADO`), sem estado novo;
  - ligado ao orçamento e à OS gerada dele, se houver;
  - observação de origem "Gerado do orçamento ORC-x: itens sem estoque suficiente.";
  - **sem valor estimado**: nenhum custo novo exposto a ninguém;
  - evento "Pedido criado".
- **Idempotente:**
  - clicar de novo sem falta nova não cria nada ("Compra já solicitada em PCI-x");
  - dois cliques ao mesmo tempo criam um pedido só, por causa da trava por orçamento na transação;
  - falta nova com o pedido ainda `SOLICITADO`: o que faltar **entra nele** (soma no item ou item novo, evento
    "Pedido editado");
  - se todos os pedidos abertos já estão em cotação, nasce outro **só com a diferença** (ver pergunta abaixo);
  - pedido cancelado ou concluído não conta.
- **Marcação:** cada item mostra "Compra solicitada · PCI-x" (abre o pedido ali mesmo) ou "N já pedido em PCI-x ·
  a solicitar M". Sem nada a pedir, o botão some.
- **Permissão:** a **mesma regra do POST de pedido com origem no orçamento**: Compras › gerenciar ou Orçamentos ›
  editar. Quem só vê o orçamento vê o painel, mas não o botão.
- **Módulos:** só com **Compras E Estoque** ligados.
  - A tela é do núcleo: o GET responde 200 `{ disponivel: false }` e o painel some, sem 403.
  - O POST (ação de Compras) usa o mesmo portão de módulo do POST do pedido.
- **Multiempresa:** orçamento de outra empresa responde 404; produtos e pedidos só da empresa da sessão.
- **Orçamento cancelado ou reprovado:** sem botão; o POST responde 400.

## Decisões

1. Tela do orçamento (não o Editar): motivo acima.
2. Necessidade **somada por produto**. A leva B mostra "faltam" linha a linha; aqui o filtro que aparece como produto
   (4) e como material (2) conta 6 contra 4 disponíveis, ou seja, faltam 2.
3. A permissão é a do pedido com origem no orçamento (não só Compras › gerenciar), para o vendedor que já podia pedir
   à mão pelo orçamento poder pedir os faltantes de uma vez.
4. Sem valor estimado no pedido: o comprador preenche na cotação. Preencher com o último custo exporia custo a quem
   abre o pedido pelo orçamento.
5. "Já solicitado" conta pedidos **abertos deste orçamento** pela quantidade pedida. Um pedido `PARCIAL` conta inteiro.

## Pergunta (não chutei)

- Com o pedido já **em cotação**, uma falta nova gera um **segundo pedido só com a diferença**. Para não mexer num
  pedido que já foi ao fornecedor, o pedido em cotação não é alterado. Se preferir que nesse caso a tela só avise
  (sem criar), é uma linha de troca.

## Testes

- `tests/unit/compra-faltantes.test.ts`: regras puras (necessidade, falta, já solicitado, plano idempotente).
- `tests/unit/compra-faltantes-pg.test.ts`: PostgreSQL real. Cobre GET 401/403/200, POST cria um pedido certo,
  idempotência (2º clique e dois cliques simultâneos), acrescentar no `SOLICITADO`, nova diferença com pedido em
  cotação, cancelado não conta, OS gerada, permissão, módulos desligados, multiempresa e orçamento cancelado.
- `tests/unit/compra-faltantes-ui.test.ts`: o painel na seção Compras num DOM real.

## Prints

ANTES: `docs/prints/orcamento-c-antes/` · DEPOIS: `docs/prints/orcamento-c-depois/`.
