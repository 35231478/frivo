# Cadastros e registros — auditoria (levas 4 e 5)

Levantamento de **todos os cadastros e registros** do sistema, feito pelo código e testado com dados fictícios locais (sem consulta à produção). Pedido antigo do Zé.

**Para cada cadastro, a pergunta foi:** existe e funciona de verdade, com permissão?
- criar e editar;
- arquivar (inativar ou cancelar);
- reativar;
- buscar e filtrar;
- a ação aparece na lista e na ficha?

**A régua da casa:** o que já tem uso **arquiva**, não apaga. Só o que nunca saiu do rascunho pode ser excluído de verdade.

**Fora desta leva:** equipamentos, tipos de equipamento e o diálogo de importação (a nuvem 1 está trabalhando lá).

**Legenda:**
- **ok** — existe, funciona e confere a permissão (na tela e na API).
- **corrigido** — estava falta ou quebrado; corrigido na leva 4.
- **leva 5** — estava falta ou quebrado; corrigido na leva 5 (as pontas soltas da leva 4, seção no fim).
- **falta** — não existe; anotado para outra leva.
- **quebrado** — existe, mas faz a coisa errada; não corrigido (risco maior, ou precisa de decisão).
- **—** — não se aplica.

## Tabela

| Cadastro | Criar | Editar | Arquivar | Reativar | Buscar | Filtrar | Permissão | Na lista | Na ficha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Clientes | ok | ok | **corrigido** ¹ | **corrigido** ¹ | ok | ok | ok | ok | **corrigido** ¹ |
| Endereços (unidades) | ok | ok | **leva 5** ² | **leva 5** | — | — | ok | — | ok |
| Contatos do cliente | ok | ok | **leva 5** ² | **leva 5** | — | — | ok | — | ok |
| Colaboradores | ok | ok | ok | ok | ok | ok | **corrigido** ³ | **leva 5** ¹⁷ | ok |
| Equipes | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Veículos | **corrigido** ⁴ | **corrigido** ⁴ | **leva 5** ⁴ | ok | ok | ok | ok | **leva 5** ¹⁷ | ok |
| Contratos | ok | **corrigido** ⁵ | **leva 5** ⁶ | ok | **corrigido** ⁷ | **leva 5** ⁶ | **leva 5** ⁶ | ok | ok |
| PMOC | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Orçamentos | ok | ok | ok | ok | **corrigido** ⁷ | ok | **corrigido** ⁸ | ok | ok |
| Ordens de serviço | ok | ok | **leva 5** ⁹ | ok | **corrigido** ⁷ | ok | **corrigido** ⁸ | ok | ok |
| Contas a pagar | ok | **corrigido** ¹⁰ | **corrigido** ¹⁰ | falta | ok | ok | ok | ok | ok |
| Contas a receber | ok | ok | ok | falta | ok | ok | ok | ok | ok |
| Medições / faturas | ok | ok | **corrigido** ¹¹ | falta | ok | **leva 5** ¹² | ok | ok | ok |
| Pedidos de compra | ok | ok | ok ¹³ | falta | ok | **leva 5** ⁶ | ok | ok | ok |
| Notas de compra | ok | ok | **leva 5** ¹⁸ | — | **leva 5** ¹⁸ | **leva 5** ¹⁸ | ok | ok | ok |
| Modelos de checklist | ok | ok | **corrigido** ¹⁴ | ok | ok | ok | ok | ok | — |
| Modelos de formulário | ok | ok | **leva 5** ¹⁵ | ok | ok | ok | ok | ok | — |
| Cadastros padrão (19) ¹⁶ | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Colaboradores (lista) | — | — | — | — | — | — | **leva 5** ¹⁹ | — | — |

## O que mudou na leva 4

1. **Clientes: inativar e reativar.**
   - **Antes:** três textos diferentes — o da lista, o do seletor de status na edição e o do sistema. Na ficha em consulta não havia ação nenhuma.
   - **Agora:** lista e ficha (consulta e edição) usam o **botão padrão dos cadastros** (`InativarRegistro`), com o mesmo texto.
   - Antes de confirmar, o botão mostra o que continua andando: contratos ativos, OS em aberto, orçamentos, contas a receber e PMOC (`GET /api/clientes/[id]/impacto`, que exige "Clientes › Excluir").
   - Nada disso bloqueia: o cliente nunca é apagado.
   - **Achado no navegador:** na ficha, o modal ficava preso ao cabeçalho com desfoque e cortado pela barra do topo. O modal do `InativarRegistro` passou a abrir pelo portal (`<body>`), em todos os lugares que o usam.
2. **Endereços e contatos.**
   - O botão dizia "**Excluir**", mas a rota já só **inativava**. Agora diz "Inativar", com o mesmo texto padrão.
   - O texto não promete "pode ser reativado depois", porque ainda não há reativação pela tela.
3. **Colaborador.** A opção "Inativo" do status aparecia para quem só edita: a API recusava, mas a tela oferecia. Agora só aparece para quem pode inativar ("Equipes › Excluir"), ou quando o colaborador já está inativo.
4. **Veículo.** O responsável e a equipe recebidos na criação e na edição não eram conferidos: um id de **outra empresa** era gravado. Agora a API recusa com 400 (`validarRefEmpresa`).
5. **Contrato.**
   - A edição (`PUT`) gravava o `status` do corpo: o padrão "ATIVO" do schema reativava um contrato suspenso ou encerrado a cada edição que não mandasse o campo, sem as regras nem o histórico da troca de status.
   - Agora o status só muda pela troca de status (`PATCH …/status`), como a tela já fazia.
6. **Contratos e pedidos de compra.** O cancelado aparece na lista padrão e não há "Mostrar cancelados", ao contrário de orçamentos e OS. Ficou para outra leva: muda o que as pessoas veem hoje.
7. **Busca pelo nome fantasia.**
   - As listas de OS, orçamentos e contratos, as sugestões da busca e o seletor de clientes procuravam só pela **razão social**: "Mercado do Zé" não achava nada.
   - Agora procuram também pelo fantasia, só na empresa da sessão.
8. **"Nova OS" e "Novo orçamento".** As páginas abriam para quem não podia criar: o botão some e a gravação já recusava, mas o endereço direto abria o formulário. Agora voltam para a lista, como "Novo cliente".
9. **OS.** Tem o próprio modal de inativar (`os-inativar`), com motivo. Funciona, mas não usa o botão padrão: unificar é outra leva, porque mexe na tela da OS.
10. **Contas a pagar.**
    - **Antes:** dava para **cancelar uma conta já paga**, pela tela e pela rota, e a saída do caixa sumia.
    - **Agora:** paga não cancela (409, "Conta paga não pode ser cancelada.") e a conta paga ou cancelada não edita (409; a página de edição volta para a ficha).
    - Com pagamento parcial, uma a uma pela tela, continua podendo; o lote continua mais rígido.
11. **Medições.** A rota de excluir apagava a medição em **qualquer etapa**; com conta a receber ligada, estourava a chave estrangeira (500). Agora exclui só o **rascunho** que não gerou conta nem nota. O resto recebe 409, com o caminho: cancelar.
12. **Medições:** a lista mistura as canceladas, sem filtro para tirá-las.
13. **Pedido de compra: cancelar com nota ligada.**
    - Hoje é permitido e pode ser legítimo (a nota foi lançada no pedido errado).
    - **Precisa de decisão do Zé antes de travar.**
14. **Modelo de checklist.** Inativar o modelo do **checklist diário obrigatório** desligava a obrigação em silêncio: o app só cobra o checklist se o modelo estiver ativo. Agora a rota recusa (409) e diz para escolher outro modelo antes.
15. **Modelos de checklist e de formulário** usam a confirmação simples (`confirmar()`), com texto próprio e o número de preenchimentos, em vez do botão padrão. Funcionam; unificar fica para outra leva.
16. **Cadastros padrão (motor único).** Produtos, serviços, fornecedores, cargos, categorias financeiras e de produto, centros de custo, contas bancárias, perfis de acesso, usuários, tipos de OS, tipos de problema, kits de material, tabelas de preço, termos de referência, modelos de prazo, modelos de encargos e modelos de documento.
    - Todos compartilham a mesma tela e as mesmas regras: criar, editar na gaveta, inativar com impacto (nunca apaga), reativar, busca, abas Ativos/Inativos e ações em massa.
    - **Tipos de equipamento** usa o mesmo motor, mas ficou fora (equipamentos).

## O que mudou na leva 5 (as pontas soltas da leva 4)

**Um jeito só de inativar.** O botão padrão (`InativarRegistro`) passou a cobrir também a OS (inativar, reabrir e recusar a solicitação), os modelos de checklist e de formulário e o descarte da nota de compra. Ele ganhou:
- abrir sem botão próprio, quando a ação nasce de um seletor de status (`variante="oculto"` + `abrirAoMontar`);
- campos extras no pedido (a recusa da OS) e o pedido próprio de reativar (a OS reabre com `PUT { status: "ABERTA" }`; os modelos, com `PUT { ativo: true }`);
- o bloco "Antes de confirmar, saiba que" virou o componente `AvisosImpacto`, reaproveitado no modal de status do contrato.

Cada um ganhou o seu `GET …/impacto`, com a mesma regra da rota que inativa: o modal mostra antes o que bloquearia (OS já em medição, modelo do checklist diário obrigatório, nota já lançada) e trava o botão.

17. **Cartões de colaboradores e veículos:** cada cartão tem o Inativar/Reativar da lista, fora do link do cartão (fechar o modal não abre a ficha).
18. **Notas de compra:**
    - busca no número, no fornecedor, no CNPJ e na chave (só os dígitos, a partir de três) e filtro de situação (Importada, Conciliada, Lançada);
    - **Descartar** a nota importada por engano, antes de lançar (Importada ou Conciliada), com Estoque › Gerenciar. A nota sai do banco com os itens e a conciliação, e fica o registro de qual era, quem descartou, quando e o motivo (`notas_compra_descartes`, 🔵 abaixo). A lista mostra os descartes recentes;
    - a nota lançada não se descarta (409): o estorno continua pela conta a pagar e pelo ajuste de estoque.
19. **`GET /api/tecnicos`** (a lista de colaboradores dos seletores) passou a exigir uma destas permissões, conferidas chamador a chamador: Equipes, Ordens, Calendário, PMOC, Contratos, Veículos, Financeiro ou Orçamentos (Visualizar). Antes bastava estar logado. O app do técnico não chama essa rota.

Por item da auditoria:
- **Endereço** ² — inativa e reativa pelo botão padrão. Principal e equipamentos ativos bloqueiam; contratos ativos, PMOC e OS em aberto daquele local viram avisos (não bloqueiam). Reativar fica na seção "Inativos" do cliente (recolhida por padrão).
- **Contato** ² — idem; o aviso diz se o contato tem acesso ao Portal do Cliente (inativo, o login para) e se é o principal.
- **Veículo** ⁴ — escolher "Inativo" no formulário mostra o impacto e pede o motivo, como o botão (o mesmo `AvisoInativacaoStatus` do colaborador e da equipe). A rota grava pela mesma função do botão (anotação nas observações, bloqueio, permissão). A opção só aparece para quem pode inativar.
- **Contrato** ⁶:
  - **cancelar exige a permissão nova "Contratos › Excluir"** (como cancelar OS e orçamento); suspender, encerrar e reativar continuam com Editar. Sem ela, "Cancelado" nem aparece no menu de status;
  - o modal de troca de status mostra antes o que a saída de Ativo cancela: as OS agendadas que ainda não começaram, as previsões de cobrança em aberto (quantas e quanto) e as OS em andamento, que seguem. A consulta usa os mesmos filtros de `encerrarFinanceiroDoContrato`, para os dois nunca divergirem;
  - a rota `DELETE` órfã do contrato saiu: o contrato só muda pela troca de status;
  - "Mostrar cancelados" (oculto por padrão), como em OS e orçamentos.
- **Pedidos de compra** ¹³ — **decisão do Zé:** o pedido com nota ligada continua cancelável (a nota pode ter sido lançada no pedido errado). Ganhou "Mostrar cancelados" (oculto por padrão).
- **Medições** ¹² — "Mostrar canceladas" (oculto por padrão), no mesmo filtro compartilhado.
- **OS** ⁹ e **modelos de formulário** ¹⁵ — no botão padrão (acima).

**Permissão nova: Contratos › Excluir.**
- Empresa nova: o perfil Financeiro já vem com ela.
- Perfis que já existem **não ganham nada sozinhos**: quem cancelava contrato com Editar deixa de poder cancelar até o administrador marcar em **Configurações › Perfis de acesso › Contratos › Excluir**. Administrador e super admin continuam podendo tudo.
- Para dar a todos os perfis que já editam contratos de uma vez, há um SQL **opcional** em `docs/sql-opcional/contratos-excluir.sql` (fora de `prisma/sql` de propósito: conceder privilégio é decisão do Zé).

**SQL (🔵, antes do merge):** `prisma/sql/2027-02-02_notas_compra_descartes.sql` — tabela nova `notas_compra_descartes`. Aditivo e idempotente; nenhuma nota existente é tocada.

## Pendências anotadas (não corrigidas)

**Reativar pela tela:** faltam contas a pagar e a receber, medições e pedidos de compra. Reativar um cancelamento precisa de regra de dinheiro: o que volta ao caixa? Quem aprova?

## Onde está

- **Regras puras:** `lib/cadastros/regras-arquivar.ts`. O texto padrão de confirmação também mora aqui, e o `InativarRegistro` passou a usá-lo.
- **Impacto do cliente:** `lib/inativacao-server.ts › impactoCliente` e `app/api/clientes/[id]/impacto`.
- **Impactos da leva 5:** `lib/inativacao-server.ts › impactoEndereco, impactoContato`, `lib/financeiro-server.ts › impactoSaidaDoContrato`, `lib/compras/notas.ts › impactoDescarteNota, descartarNota` e as rotas `…/impacto`.
- **Filtros das listas:** `lib/listas/filtros.ts` (`whereContratos`, `wherePedidosCompra`, `whereMedicoes`, `whereNotasCompra`), os mesmos da tela e da ação em massa.
- **Testes:**
  - `cadastros-pontas-regras` e `cadastros-pontas2-regras`: regras, filtros e portões das páginas;
  - `cadastros-pontas-pg` e `cadastros-pontas2-pg`: rotas de verdade em PostgreSQL, com dados de outra empresa de propósito;
  - `cadastros-pontas-ui` e `cadastros-pontas2-ui`: telas (mais o cancelamento em `contrato-form-ui` e os cartões em `padronizacao-leva4b-ui`);
  - `sql-cadastros-pontas2`: os dois SQLs rodados duas vezes num PostgreSQL.
- **Prints da leva 5:** `docs/prints/cadastros-pontas-2/` (antes e depois, computador e celular, dados fictícios).
