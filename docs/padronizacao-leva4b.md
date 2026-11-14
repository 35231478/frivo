# Padronização de telas — leva 4B

**Veículos, Colaboradores e Equipes** — a segunda metade da leva 4 (a 4A, de clientes, equipamentos e
QR Codes, já está no ar). Reusa o que as levas anteriores deixaram prontos (`TabelaPro` e os
componentes de lista, `Dica`, `SelectCadastroRapido` com criar e editar no contexto, toast e
confirmação próprios) — nada paralelo.

**Tem alteração de banco (🔵).** Um único arquivo, só de acréscimo:
`prisma/sql/2027-01-03_checklist_veiculo_editar_inativar.sql`. Ele precisa rodar **antes** do merge
(está descrito no fim deste documento). Tudo o mais da leva é fiação de tela e não toca o banco.

## Os três consertos funcionais

### 1. Checklist de veículo preenchido: Detalhe, Editar e Excluir

**Como era.** O checklist era preenchido e sumia de vista. Ele aparecia só como uma linha (data,
colaborador e situação) na aba "Checklists" da ficha do veículo — sem abrir as respostas, sem corrigir
um erro de preenchimento e sem tirar um preenchido em duplicidade. Em `/veiculos/checklist` só havia o
formulário de preencher.

**Como ficou.**

- `/veiculos/checklist` ganhou duas abas: **Preencher** (o formulário de sempre) e **Preenchidos** (a
  lista, no padrão da casa: tabela no computador, cartões no celular, pesquisa por placa, colaborador
  ou modelo).
- Cada linha tem **Detalhe** (as respostas item a item, com a foto e o item em alerta marcado),
  **Editar** (corrige respostas, observação e colaborador) e **Excluir**.
- **Excluir é reversível.** O checklist é inativado: sai da lista e das contagens, mas as respostas e
  as fotos ficam guardadas. A aba **Inativos** mostra quem excluiu e quando, e traz o **Reativar**.
- **Editar recalcula no servidor** o alerta de cada item e a situação (Concluído × Com alertas) — a
  tela não decide. Fica registrado quem editou e quando; a linha mostra "editado".
- **Checklist inativado não se edita** (reative antes) e **não conta**: o veículo volta a aparecer em
  "Sem checklist hoje", no alerta de checklist pendente e some dos "com alertas" do dia.
- A mesma lista aparece na aba **Checklists da ficha do veículo**, filtrada por ele (no lugar da tabela
  antiga, sem ações). Essa aba fica fora do bloqueio de "somente leitura" da ficha: quem só consulta
  abre o Detalhe.

**Quem pode o quê** (a tela esconde o botão e o servidor recusa com 403):

| Ação | Permissão |
|---|---|
| Ver a lista e o detalhe | Veículos › visualizar |
| Preencher | Veículos › checklist (como já era) |
| Editar e Reativar | Veículos › gerenciar |
| Excluir (inativar) | Veículos › excluir |

Quem só preenche (o técnico em campo, com Veículos › checklist) continua vendo só o formulário.

### 2. Responsável técnico cadastrado na hora, em Dados da empresa

**Como era.** O seletor do RT padrão só listava. Sem nenhum cadastrado, um parágrafo mandava ir a
Equipes › Colaboradores, criar a pessoa com o tipo certo e o CREA, e voltar.

**Como ficou.** O seletor é o mesmo dos outros cadastros: escolhe, **cadastra um novo ali mesmo**
(nome, CPF, CREA e telefone — o colaborador já nasce como responsável técnico) e **edita o escolhido no
contexto** (nome, telefone e CREA). "Nenhum (o documento não mostra RT)" continua sendo uma escolha.
Cadastrar e editar pedem Equipes › gerenciar, a permissão do cadastro de colaborador; sem ela, a
pessoa só escolhe.

Para o "editar no contexto" existir sem reenviar a ficha inteira, a rota do colaborador passou a
aceitar a correção parcial de **nome, telefone e CREA** — só esses três; qualquer outro campo é
recusado. Responsável técnico não pode ficar sem CREA.

### 3. Reativar formulário de OS e modelo de checklist inativados

**Como era.** Na leva 3 o "Inativar" entrou nessas duas telas, mas o inativado sumia sem volta.

**Como ficou.** As duas telas ganharam as abas **Ativos | Inativos**, com a contagem de cada uma, e o
botão **Reativar** na aba Inativos (só para quem gerencia). O aviso do Inativar agora diz onde o
registro foi parar. Sem alteração de banco: a leitura dos formulários passou a devolver os inativados
sob filtro (`?inativos=1`); a dos modelos já trazia os dois.

As abas de situação viraram um componente só (`components/listagem/abas-situacao.tsx`), usado pelo
cadastro padrão, pelos formulários, pelos modelos e pelos checklists preenchidos.

## Prioridade nº 1: botão só para quem pode

As rotas dessas telas **já recusavam** (403) quem não tem a permissão. O levantamento conferiu tela por
tela e achou o seguinte:

| Tela | O que havia | Agora |
|---|---|---|
| Colaboradores (lista) | O nome, a linha e o lápis levavam à ficha — que **recusa** quem não tem Equipes › gerenciar (a pessoa caía em "sem permissão") | Sem a permissão, o nome não é link e a linha não tem lápis |
| Equipes (cartões) | O cartão da equipe e o do colaborador levavam à ficha que recusa | Sem a permissão, o cartão não é link |
| Ficha do veículo › Manutenções | **Excluir tirava a manutenção da tela mesmo quando o servidor recusava**; registrar falhava em silêncio | A lista só muda com o "ok" do servidor; recusado, aparece o motivo. Em somente leitura os botões não aparecem |
| Ficha do veículo › Checklists | "Preencher novo checklist" para todos | Só com Veículos › checklist |
| Veículos (lista) | Já seguia a permissão | Mantido; quem só consulta vê o olho ("Ver ficha") no lugar do lápis |
| Montador, App do colaborador, formulários de veículo e equipe | Já seguiam a permissão (a página recusa) | Mantido |

**A tela não muda quando o servidor recusa:** em todas as ações desta leva a lista só é atualizada
depois do "ok" do servidor. Recusado, aparece o motivo e a tela fica como estava. Cancelar a
confirmação não grava nada.

## Padrão de lista

- **Veículos** e **Colaboradores**: as tabelas próprias passaram para a tabela da casa (`TabelaPro`:
  colunas ajustáveis e preferência por usuário, ordenação no cabeçalho, seleção em massa), com a lista
  compacta no celular e a visão em cartões mantidas. Cabem num notebook sem rolar de lado.
- **Equipes**: continua em cartões (a tela nunca foi tabela; o cartão mostra cor, líder e membros).
  Ver a pergunta 3 abaixo.

## Toast em toda gravação

Passaram a avisar: salvar veículo e equipe, registrar e excluir manutenção, salvar a composição do
montador, salvar o App do colaborador (antes uma faixa fixa na página), o cadastro rápido de
colaborador e **inativar/reativar** em todos os cadastros que usam o botão compartilhado (veículo,
colaborador, equipe, orçamento…). O cadastro padrão já avisava por conta própria; para não avisar duas
vezes, o aviso ficou num lugar só (o botão).

## Cadastrar na hora e editar no contexto

| Seletor | Cadastra | Edita o escolhido |
|---|---|---|
| RT padrão (Dados da empresa) | colaborador com CREA | nome, telefone, CREA |
| Responsável do veículo | colaborador | nome, telefone |
| Equipe do veículo | equipe (só o nome) | nome |
| Líder da equipe | colaborador | nome, telefone |
| Membros da equipe | "Novo colaborador" (já entra marcado) | — (lista de marcar) |

A rota da equipe ganhou a correção parcial de **nome e cor** (membros e veículos continuam só na
ficha). Veículo não tem cadastro rápido: o cadastro dele passa pela leitura do CRLV.

## Instrução no ⓘ e vocabulário

As instruções soltas foram para o ⓘ: a descrição da página do checklist, as três dicas do formulário de
equipe, as de documentos e seguro do veículo, a do montador ("Arraste os colaboradores…") e a do App do
colaborador. "Template" virou "modelo de checklist"; "Nova Equipe" virou "Nova equipe"; "membro(s)"
virou "1 membro / 2 membros"; "Erro de conexão" virou "Sem conexão. Tente de novo.". O cabeçalho do App
do colaborador perdeu o ícone colorido (o padrão é neutro).

## Telas tocadas

| Tela | Antes | Depois |
|---|---|---|
| `/veiculos` | tabela própria | tabela da casa; aviso ao inativar/reativar |
| `/veiculos/novo` e `/veiculos/[id]/editar` | sem aviso ao salvar; seletores simples; manutenção que sumia sem o servidor aceitar; histórico de checklists sem ações | toast; responsável e equipe com cadastrar/editar; manutenção só muda com o "ok"; lista de checklists com Detalhe/Editar/Excluir |
| `/veiculos/checklist` | só o formulário; erro em caixa, sem aviso | Preencher \| Preenchidos; toast; "modelo" |
| `/colaboradores` | tabela própria; link para ficha que recusa | tabela da casa; link só para quem pode; toast no cadastro rápido |
| `/equipes` | cartões que levavam à ficha que recusa | cartões sem link para quem só consulta; ⓘ; vocabulário |
| `/equipes/novo` e `/equipes/[id]/editar` | sem aviso ao salvar; líder em seletor simples; dicas soltas | toast; líder com cadastrar/editar; "Novo colaborador" nos membros; dicas no ⓘ |
| `/equipes/montador` | instrução solta; resultado só na barra | instrução no ⓘ; toast |
| `/equipes/app-colaborador` | ícone colorido, parágrafo, faixa de sucesso fixa | cabeçalho neutro, ⓘ, toast |
| Configurações › Dados da empresa | RT só para escolher | RT com cadastrar na hora e editar no contexto |
| Configurações › Formulários | inativado sumia | abas Ativos \| Inativos + Reativar |
| Configurações › Checklists de veículo | inativado sumia | abas Ativos \| Inativos + Reativar |

Prints de antes e depois (computador, celular e "sem permissão") em `docs/prints/padronizacao-leva4b/`.

## O SQL (🔵 — roda antes do merge)

`prisma/sql/2027-01-03_checklist_veiculo_editar_inativar.sql`, só na tabela `checklist_preenchidos`:

- 4 colunas novas, todas opcionais: `editado_em`, `editado_por_id`, `inativado_em`, `inativado_por_id`;
- 2 chaves para `usuarios` (quem editou e quem inativou), com `ON DELETE SET NULL`;
- 1 índice (`empresa_id, inativado_em, criado_em`) para a lista.

É só acréscimo e pode rodar mais de uma vez (`IF NOT EXISTS`). Nenhum dado existente muda: os
checklists já preenchidos ficam ativos e sem edição registrada. Enquanto o SQL não rodar, o código
novo **não funciona** nas telas de checklist de veículo (ele lê as colunas novas) — por isso a ordem é
SQL primeiro, merge depois.

Não foi aplicado em produção: rodou só no banco local descartável dos testes.

## Como foi verificado

- **Rotas com PostgreSQL de verdade** (`tests/unit/padronizacao-leva4b-pg.test.ts`): quem só visualiza
  leva 403 em cada uma das 31 gravações das telas da leva, e o banco inteiro fica idêntico (todas as
  tabelas); sem login, 401; mais as regras do checklist preenchido, do RT, da equipe e do Reativar.
- **Telas montadas** (`tests/unit/padronizacao-leva4b-ui.test.ts`): cada botão aparece só com a sua
  permissão; recusa do servidor não muda a tela; cancelar não grava; toasts; abas Inativos.
- **Mutação**: cada regra foi quebrada de propósito, uma por vez, para conferir que algum teste acusa.
- **Navegador de verdade** (Chromium, aplicativo rodando, banco local): o caminho inteiro de cada
  conserto, com conferência no banco, em computador (1440 px) e celular (390 px), sem rolagem lateral.
- A suíte inteira do projeto.

## Decisões tomadas e perguntas em aberto

1. **Permissões do checklist preenchido.** O pedido dizia "conforme permissão", sem dizer qual. Usei as
   que já existem em Veículos: ver = visualizar; editar e reativar = gerenciar; excluir = excluir.
   **Confirma?** A alternativa seria deixar quem preenche (Veículos › checklist) corrigir o próprio
   checklist — não fiz porque hoje o checklist não guarda quem o preencheu (só o colaborador escolhido
   no formulário, que pode ser outra pessoa).
2. **Tipo de equipe do RT cadastrado na hora.** O colaborador criado pelo seletor nasce como "equipe de
   campo", o padrão do cadastro. Se o RT for administrativo, ajusta-se na ficha. **Prefere que o RT
   nasça como administrativo?**
3. **Equipes continua em cartões.** O checklist da leva manda migrar as listas "de tabela própria"; a
   de equipes nunca foi tabela, e o cartão mostra coisas que uma linha não mostra (cor, avatares). Não
   migrei. **Quer também a visão em tabela?**
4. **Preencher checklist: o alerta ainda vem da tela.** Na edição o servidor recalcula o alerta; no
   preenchimento (rota antiga) ele continua aceitando o que a tela manda. Não mexi por estar fora do
   pedido e por ser a rota que o app do técnico usa. Dá para endurecer num PR à parte.
5. **Editar no contexto o veículo da equipe e os membros**: não há (são listas de marcar, não
   seletores). O cadastro de veículo passa pelo CRLV e não tem versão rápida.
