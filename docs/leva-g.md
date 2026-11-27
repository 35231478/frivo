# Leva G — Configurações e Perfil

🟢 **Sem banco.** Nenhuma coluna nova, nenhum SQL. As colunas antigas de bloqueio da tabela de preço
(`tabelas_preco.precos_bloqueados`, `tabela_preco_itens.bloqueado`) ficam no banco, sem uso: a tela grava sempre `false`.

## 1 e 2. Produtos e Serviços: Editar

**Causa:** o Editar existia (o lápis na última coluna), mas em Configurações › Operacionais a lista abre numa
gaveta estreita. A tabela rolava para o lado e a coluna de ações ficava fora da vista.

**Conserto** (no componente comum, vale para todos os cadastros padronizados):
- a **linha inteira abre o editor**, com clique ou Enter. É o mesmo formulário do cadastro: em Produtos vem com o
  Uso (Material/Peça); em Serviços, com a composição de materiais;
- a **coluna de ações fica presa à direita** (`ColunaPro.grudada`), com o fundo da linha (listrada, hover e
  selecionada);
- quem não tem a permissão de editar não recebe o clique: a linha fica só leitura e não aparece o lápis;
- a caixa de seleção, os botões e os links da linha continuam sendo deles: clicar neles não abre o editor.

Conferidos na tela: criar, editar, inativar, reativar e buscar.

## 3. Tabelas de preço

### Na tela da tabela

- **Saíram os dois botões de bloqueio**, "Preços bloqueados" na tabela e o cadeado por item.
- **Adicionar em massa:**
  - o filtro tem texto (nome ou código, sem acento) e tipo (Todos, Serviços, Produtos);
  - cada linha tem a sua caixa;
  - "Selecionar todos do filtro (N)" marca só o que está visível. Clicar de novo desmarca só esses; o resto da seleção fica;
  - "Adicionar selecionados" põe tudo na tabela de uma vez, com o preço padrão de cada item;
  - o que já está na tabela sai da lista de escolha.

### Regra nova: o preço de tabela fica travado

O preço que vem da tabela do cliente (o do contrato) fica **sempre travado** no orçamento e na OS.

**Quem pode mudar:** só quem tem a permissão **"Alterar preço de tabela"**. Ela fica em Perfis › Orçamentos,
vale para o orçamento e para a OS, e o administrador já tem.
- Mudar pede o **motivo**, de 5 a 300 caracteres.
- O motivo vai para a trilha:
  - no orçamento, no Histórico, como "Preço de tabela alterado";
  - na OS, no histórico da OS;
  - a linha registra quem mudou, o item, o valor de → para e o motivo.
- Não há botão de destravar na tela. Uma empresa que quer flexibilidade dá a permissão pelo perfil.

**Quem decide é o servidor.** Ele compara cada item do catálogo com a tabela **ativa** ligada ao cliente, no
momento de gravar (`lib/precos/trava-tabela.ts`, `lib/precos/trava-tabela-server.ts`):

| Situação | Resultado |
|---|---|
| Item no preço da tabela | grava, sem pedir nada |
| Fora da tabela, sem a permissão | **403**, com os itens no aviso, e nada é gravado |
| Fora da tabela, com a permissão, sem motivo | **400**: "Informe o motivo…" |
| Fora da tabela, com a permissão e o motivo | grava e registra na trilha |
| Valor que **já estava gravado** naquele item (salvar de novo um orçamento antigo) | não pede de novo |
| Item sem catálogo, item fora da tabela, cliente sem tabela, tabela inativa, tabela de outra empresa | livre |

Por onde a regra passa: criar e editar o orçamento, editar a linha (lápis) do orçamento, e incluir, editar e
editar como uso um item da OS.
- No **serviço com materiais**, o preço comparado é a base unitária, antes dos materiais inclusos.
- Se o total foi digitado à mão, compara o unitário efetivo.

**Na tela:**
- sem a permissão, o preço da tabela aparece com cadeado e sem campo ("Preço definido em contrato — não pode ser alterado");
- com a permissão, o campo abre. Ao mudar, aparece o campo do motivo, que é pedido antes de salvar;
- o rótulo acima dos itens diz qual dos dois casos vale.

## 4. Meu perfil

Redesenhado com **três abas** (antes eram quatro):

| Aba | O que tem |
|---|---|
| **Dados** | foto, nome, telefone (novo, na coluna que já existia), e-mail (com confirmação e senha atual, como antes); **um** "Salvar alterações", que só acende quando algo mudou e manda só o que mudou; "Descartar" |
| **Segurança** | Senha (um só "Trocar senha") e "Sessões e aparelhos" (o último acesso; trocar a senha encerra as outras sessões) |
| **Preferências** | notificações neste aparelho (só aparece quando o aparelho tem notificações) |

- O cabeçalho mostra a foto, o nome, o e-mail e **uma** linha "perfil de acesso · empresa". Antes o papel aparecia duas vezes.
- Os links antigos continuam funcionando: `?aba=foto` e `?aba=conta` levam a Dados, e `?aba=notificacoes` leva a Preferências.
- **Não inventei** o que não existe: o sistema não tem 2FA nem tema escuro. A lista de sessões ativas, com botão de
  encerrar, mexe na segurança do login, que está fora do escopo (pergunta abaixo).

## 5. Botão flutuante de anotações

- **Arrasta** com o mouse e com o dedo (eventos de ponteiro, com captura).
- Um movimento de menos de 5 px conta como clique. O clique que o navegador dispara depois de um arraste **não**
  liga o modo de anotação.
- **Lembra a posição por usuário** neste navegador (`localStorage`, chave `frivo:anotacoes-botao:<id do usuário>`).
- Se o navegador não guarda dados, a posição vale só nesta visita.
- **Nunca sai da tela visível:** fica a 8 px das bordas, inclusive quando a janela encolhe ou quando a posição
  gravada veio de uma tela maior.
- **"Voltar à posição padrão":** um botão pequeno ao lado, que só aparece quando o botão foi movido.
- Continua só para o dono do sistema e a partir da largura `lg` (decisão anterior).

## Testes

- `tests/unit/leva-g.test.ts`, regras puras: a trava, o veredito, a trilha, a tela do orçamento, a permissão nos
  perfis, a seleção em massa, as abas, o corpo do perfil e a posição do botão.
- `tests/unit/leva-g-ui.test.ts`, telas (DOM): a linha que abre e a coluna presa, Produtos com e sem a permissão,
  o preço travado na grade, a seleção em massa até salvar, o perfil, e o arraste com a posição gravada.
- `tests/unit/preco-tabela-pg.test.ts`, **PostgreSQL real**, com as rotas de verdade:
  - orçamento: criar, editar e a linha;
  - OS: incluir, PUT e PATCH;
  - permissão: sem ela, com ela, administrador;
  - motivo e trilha;
  - o preço já gravado não pede de novo;
  - tabela inativa, cliente sem tabela e tabela de outra empresa.
