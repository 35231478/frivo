# Padronização de telas — leva 4A

**Clientes, Equipamentos e QR Codes.** Sem alteração de banco: é fiação de tela. Reusa o que as levas
anteriores deixaram prontos (`TabelaPro` e os componentes de lista, `Dica`, `SelectCadastroRapido` com
criar e editar no contexto, toast e confirmação próprios) — nada paralelo.

A leva 4 foi dividida em dois PRs. Este é o 4A; o 4B (veículos, colaboradores e equipes) só começa
depois deste mergeado.

## Prioridade nº 1: botão só para quem pode

As rotas dessas telas **já recusavam** (403) quem não tem a permissão. O levantamento conferiu tela por
tela e rota por rota:

| Tela | O que havia | Agora |
|---|---|---|
| QR Codes (lista) | Gerar e Vincular já seguiam QR Codes › gerenciar. **Não havia** como desvincular nem inativar uma etiqueta pela lista (só pela edição do equipamento) | Desvincular, Inativar e Reativar na linha, só com QR Codes › gerenciar. Imprimir continua para quem visualiza |
| QR Codes (impressão) | Só o botão Imprimir (leitura) | Mantido: imprimir não grava nada |
| Clientes (lista) | Editar com "editar", Inativar com "excluir", dentro de um menu de três pontos | As mesmas permissões, com os ícones na linha; Reativar (com "editar") para o cliente inativo, como na ficha |
| Equipamentos (lista e ficha) | Já seguiam criar / editar / excluir | Mantido |
| Aba QR Code da edição do equipamento | Desvincular sem confirmação | Desvincular pede confirmação |

**Sobre o inventário:** ele marcava `/qrcodes` como "sem permissão nos botões". Não era bem isso — a
varredura automática não segue o arquivo vizinho (`./qrcodes-client`) e não viu a checagem que já
existia. O que faltava de verdade em QR Codes era a versão de celular, as ações de desvincular e
inativar, e o aviso depois de gravar.

**A tela não muda quando o servidor recusa:** em todas as ações desta leva a lista só é atualizada
depois do "ok" do servidor. Recusado, aparece o motivo (toast de erro) e a tela fica como estava.
Cancelar a confirmação não grava nada.

**Inativar, e não excluir.** Etiqueta, cliente e equipamento não são apagados pela tela: inativar é
reversível e guarda o histórico. A rota que apaga a etiqueta de vez continua existindo (e exigindo
QR Codes › gerenciar), mas a tela não a oferece.

## QR Codes: o conserto funcional

- **Celular.** Antes o cabeçalho estourava a largura e a tabela cortava. Agora a lista vira cartões
  (código, equipamento, status, data e as ações, com área de toque maior), com a pesquisa numa linha e
  os filtros na de baixo. O "Vincular" lista os equipamentos dentro do próprio diálogo, com pesquisa.
- **Lista no padrão**: `TabelaPro` (colunas ajustáveis, preferência por usuário), pesquisa por código
  ou equipamento, filtros de vínculo e status, contador e estado vazio.
- **Qual equipamento é qual.** A lista e o seletor de "Vincular" mostravam só marca e modelo — num
  prédio com 40 splits iguais não dava para saber qual escolher. Agora o apelido vem primeiro e o
  seletor mostra cliente, unidade e ambiente ("Split UTI 1 · LG S4-W12 — Hospital Santa Clara · Matriz · UTI").
- **Impressão no celular.** As colunas da folha espremiam e uma etiqueta caía em cima da outra. A
  folha agora fica em tamanho real dentro de uma moldura que rola de lado; as opções empilham; o botão
  Imprimir ocupa a largura. No papel, sai como sempre.
- Erro do servidor que não vem em JSON (queda, 502) não derruba mais a tela; as rotas respondem 400 a
  corpo vazio em vez de quebrar.

## Padrão de lista

As tabelas próprias passaram para `TabelaPro`, com cartões no celular:

- **Clientes**: a lista do servidor (busca, filtros, ordenação e paginação pela URL) na tabela da casa.
  A razão social aparece ao passar o mouse sobre o nome fantasia.
- **Equipamentos**: a tabela cabe num notebook sem rolar de lado (antes, com muitas colunas, as ações
  podiam sair da vista). O inativo leva o selo ao lado do nome; cliente e unidade dividem uma coluna e
  continuam filtrando ao clicar.
- **Histórico de OS** na edição do equipamento: lista com o número da OS levando à OS.

## Feedback

Toda gravação avisa com **toast**: inativar e reativar cliente e equipamento, salvar equipamento (pelo
formulário e pela foto), gerar, vincular e desvincular QR. Antes, várias dessas gravações terminavam
em silêncio.

## Editar no contexto

No formulário de equipamento (novo e edição) e no cadastro pela foto, o **cliente** e a **unidade**
escolhidos ganharam o lápis de editar no contexto, com o rótulo do que está sendo editado
("Editando o cadastro do cliente — vale em todo lugar onde este cadastro é usado").

## Sugestão inteligente: CNPJ no cadastro rápido de cliente

O cadastro rápido (o que abre de dentro da OS, do orçamento, do contrato e do equipamento) ganhou o
botão **Consultar** ao lado do CNPJ, usando a mesma consulta do cadastro completo.

- Só liga com os 14 dígitos; para pessoa física, não aparece.
- **Sugere, não preenche no escuro**: entra só no campo que está vazio. O que a pessoa já digitou não é
  trocado.
- A tela diz de onde veio e o que entrou: "Dados da Receita Federal: nome / razão social e nome
  fantasia. Confira antes de salvar."
- Tudo continua editável. Se a consulta falha, aparece o motivo e o cadastro segue à mão.
- O botão e a frase ficam fora do rótulo do campo (leitor de tela lê só "CPF / CNPJ").

A consulta traz razão social, nome fantasia e telefone — os campos que o cadastro rápido tem.

## Vocabulário

"Novo Cliente" virou "Novo cliente"; "etiqueta(s)" virou "1 etiqueta / 3 etiquetas"; "buscar" virou
"pesquisar"; "Erro de conexão" virou "Sem conexão. Tente de novo."; os títulos das confirmações são a
pergunta curta ("Inativar Split da recepção?").

## Telas tocadas

| Tela | Rota | O que mudou |
|---|---|---|
| Clientes | `/clientes` | Tabela da casa; ações na linha; Reativar; toast |
| Equipamentos | `/equipamentos` | Tabela da casa sem rolagem lateral; toast ao inativar e reativar |
| Ficha do equipamento | `/equipamentos/[id]` | Toast ao gerar QR, inativar e reativar (as permissões já estavam certas) |
| Editar equipamento | `/equipamentos/[id]/editar` | Toast ao salvar; cliente e unidade com editar no contexto; histórico em lista; aba QR com confirmação e toast |
| Novo equipamento | `/equipamentos/novo` | Toast ao salvar; cliente e unidade com editar no contexto; CNPJ no cadastro rápido |
| Novo equipamento pela foto | `/equipamentos/novo/foto` | Toast ao salvar; unidade com editar no contexto |
| QR Codes | `/qrcodes` | Reescrita no padrão de lista, com celular e as ações novas |
| Imprimir QR Codes | `/qrcodes/imprimir` | Responsiva; contagem no plural |
| Cadastro rápido de cliente | (dentro da OS, orçamento, contrato e equipamento) | Consultar CNPJ |

O aviso de privacidade do cadastro pela foto (envio da foto da etiqueta para leitura) **continua
visível** na tela, de propósito.

## O que não entrou

- E-mail e opção pelo Simples no cadastro rápido de cliente: a Receita devolve os dois, mas o cadastro
  rápido não tem esses campos e preencher campo que a pessoa não vê seria "preencher no escuro".
  Fica a pergunta no PR.
- A ficha do cliente (`/clientes/[id]/editar` e `/clientes/novo`): é a referência de ouro e a
  varredura não apontou nada; não foi tocada.
- Qualquer mudança no RBAC do painel, em pagamento ou em login.
- Veículos, colaboradores e equipes: leva 4B.

## Testes

- `tests/unit/padronizacao-leva4a-pg.test.ts` — rotas reais com PostgreSQL real: quem só visualiza leva
  403 em toda gravação de clientes, unidades, equipamentos e QR Codes, e o banco inteiro fica idêntico;
  sem login, 401; desvincular não apaga a etiqueta nem mexe no equipamento; inativar é reversível;
  inativar cliente e equipamento exige "excluir" e reativar basta "editar"; a consulta de CNPJ exige
  login e recusa CNPJ incompleto.
- `tests/unit/padronizacao-leva4a-ui.test.ts` — telas num DOM de verdade: sem a permissão não há botão;
  recusa do servidor não muda a tela; cancelar não grava; toast; padrão de lista; a consulta de CNPJ só
  entra em campo vazio.
- Teste existente atualizado por mudança intencional: `ux3-toast` (o título da confirmação de inativar
  equipamento virou a pergunta curta).
- **Mutação**: 124 regras quebradas uma por vez (a permissão de cada rota, cada botão, cada confirmação,
  o "só em campo vazio" do CNPJ). 123 foram pegas de primeira. A que sobreviveu — vincular etiqueta a
  equipamento de outra empresa — mostrou um teste fraco (o servidor estava certo, mas o teste passava
  pelo motivo errado); o teste foi reforçado e agora pega.
- **Navegador de verdade** (Chromium, app real, banco local descartável): 110 conferências em desktop e
  celular. A resposta da Receita foi simulada no navegador (o ambiente local não alcança a BrasilAPI);
  a rota de verdade tem teste próprio. O roteiro achou três defeitos que os testes de DOM não pegam,
  corrigidos nesta leva: a lista do seletor de vincular cortada no celular, a coluna de ações de
  equipamentos estreita (gerava rolagem lateral) e a frase da consulta dentro do rótulo do campo.

Prints em `docs/prints/padronizacao-leva4a/` (`antes-*` e `depois-*`, desktop e celular, e as versões
`-sem-permissao`).
