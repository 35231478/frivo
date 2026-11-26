# Cadastros e registros — auditoria (leva 4)

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
- **corrigido** — estava falta ou quebrado; corrigido nesta leva.
- **falta** — não existe; anotado para outra leva.
- **quebrado** — existe, mas faz a coisa errada; não corrigido (risco maior, ou precisa de decisão).
- **—** — não se aplica.

## Tabela

| Cadastro | Criar | Editar | Arquivar | Reativar | Buscar | Filtrar | Permissão | Na lista | Na ficha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Clientes | ok | ok | **corrigido** ¹ | **corrigido** ¹ | ok | ok | ok | ok | **corrigido** ¹ |
| Endereços (unidades) | ok | ok | **corrigido** ² | falta | — | — | ok | — | ok |
| Contatos do cliente | ok | ok | **corrigido** ² | falta | — | — | ok | — | ok |
| Colaboradores | ok | ok | ok | ok | ok | ok | **corrigido** ³ | ok | ok |
| Equipes | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Veículos | **corrigido** ⁴ | **corrigido** ⁴ | ok | ok | ok | ok | ok | ok | ok |
| Contratos | ok | **corrigido** ⁵ | falta ⁶ | ok | **corrigido** ⁷ | falta ⁶ | ok | ok | ok |
| PMOC | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| Orçamentos | ok | ok | ok | ok | **corrigido** ⁷ | ok | **corrigido** ⁸ | ok | ok |
| Ordens de serviço | ok | ok | ok ⁹ | ok | **corrigido** ⁷ | ok | **corrigido** ⁸ | ok | ok |
| Contas a pagar | ok | **corrigido** ¹⁰ | **corrigido** ¹⁰ | falta | ok | ok | ok | ok | ok |
| Contas a receber | ok | ok | ok | falta | ok | ok | ok | ok | ok |
| Medições / faturas | ok | ok | **corrigido** ¹¹ | falta | ok | falta ¹² | ok | ok | ok |
| Pedidos de compra | ok | ok | quebrado? ¹³ | falta | ok | falta ⁶ | ok | ok | ok |
| Notas de compra | ok | ok | falta | — | falta | falta | ok | ok | ok |
| Modelos de checklist | ok | ok | **corrigido** ¹⁴ | ok | ok | ok | ok | ok | — |
| Modelos de formulário | ok | ok | ok ¹⁵ | ok | ok | ok | ok | ok | — |
| Cadastros padrão (19) ¹⁶ | ok | ok | ok | ok | ok | ok | ok | ok | ok |

## O que mudou nesta leva

1. **Clientes: inativar e reativar.**
   - **Antes:** três textos diferentes — o da lista, o do seletor de status na edição e o do sistema. Na ficha em consulta não havia ação nenhuma.
   - **Agora:** lista e ficha (consulta e edição) usam o **botão padrão dos cadastros** (`InativarRegistro`), com o mesmo texto.
   - Antes de confirmar, o botão mostra o que continua andando: contratos ativos, OS em aberto, orçamentos, contas a receber e PMOC (`GET /api/clientes/[id]/impacto`, que exige "Clientes › Excluir").
   - Nada disso bloqueia: o cliente nunca é apagado.
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

## Pendências anotadas (não corrigidas)

**Reativar pela tela:**
- Faltam endereços, contatos, contas a pagar e a receber, medições e pedidos de compra.
- Para a maioria, reativar um cancelamento precisa de regra de dinheiro: o que volta ao caixa? Quem aprova?

**Inativar com vínculos:**
- **Endereço:** inativar só confere equipamentos ativos. Não avisa contratos, PMOC nem OS em aberto daquele local.
- **Contrato:** o cancelamento pelo menu pede "Contratos › Editar" e não mostra o impacto (OS recorrentes e previsões). A rota `DELETE` do contrato não tem quem a chame.
- **Veículo:** o status "Inativo" pelo formulário não pede motivo (o botão pede).

**Telas:**
- **Notas de compra:** sem busca, sem filtro e sem descartar um lançamento errado.
- **Colaboradores e veículos:** na visão de cartões não há Inativar (na lista, há).

**Permissão:** `GET /api/tecnicos` não exige permissão de módulo. Vários seletores dependem dela, então mudar exige olhar cada chamador.

## Onde está

- **Regras puras:** `lib/cadastros/regras-arquivar.ts`. O texto padrão de confirmação também mora aqui, e o `InativarRegistro` passou a usá-lo.
- **Impacto do cliente:** `lib/inativacao-server.ts › impactoCliente` e `app/api/clientes/[id]/impacto`.
- **Testes:**
  - `cadastros-pontas-regras`: regras e portões das páginas;
  - `cadastros-pontas-pg`: rotas de verdade em PostgreSQL, com dados de outra empresa de propósito;
  - `cadastros-pontas-ui`: telas.
