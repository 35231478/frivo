# Padronização de telas — leva 3

As telas pequenas de **Configurações** que estavam fora do padrão. Sem alteração de banco: é fiação de
tela. Reusa o que as levas 1 e 2 deixaram prontos (`TelaCadastroApoio`, `TabelaPro` e os componentes de
lista, `Dica`, `SelectCadastroRapido`, toast e confirmação próprios) — nada paralelo.

## Prioridade nº 1: botão só para quem pode

Todas as rotas dessas telas **já recusavam** (403) quem não tem a permissão de gravar. O defeito estava
na tela: os botões apareciam para quem só visualiza, e em dois lugares a tela mudava **mesmo com a
recusa do servidor**.

| Tela | Antes | Agora |
|---|---|---|
| Formulários | Novo, Editar e Excluir para todos; falha ao excluir em silêncio | Só com Configurações › gerenciar; a recusa vira aviso |
| Checklists de veículo | Novo, Editar e Desativar para todos; **desativava na tela mesmo com 403** | Só com Configurações ou Frota › gerenciar; a lista só muda se o servidor aceitar |
| E-mail transacional | Salvar e Testar para todos | Só com a permissão |
| Modelos de e-mail | Editar e "Restaurar padrões" para todos | Só com a permissão; quem só vê abre o modelo e a prévia |
| Dados da empresa e Preferências | Salvar, Trocar e Excluir a logo para todos; **a logo sumia da tela sem conferir a resposta** | Só com a permissão; excluir a logo pede confirmação e respeita a recusa |
| QR Code | Salvar para todos | Só com a permissão |
| Banco Inter | Salvar, Testar e Gerar webhook para todos | Só com a permissão |
| Padronização de digitação | "Pré-visualizar" para quem a rota recusa | Sem a permissão, nem a prévia é oferecida |
| Numeração, Orçamentos e propostas, Impressão da OS | Já seguiam a permissão | Mantido |

Sem a permissão, a tela abre **só para leitura**: campos travados, sem os botões, e o aviso no formato
da casa — "Somente leitura: requer a permissão Configurações › gerenciar." (`SomenteLeitura`, em
`components/config/permissao-config.tsx`). O RBAC do painel não foi alterado: a tela passou a usar a
mesma permissão que a rota já exigia.

## Padrão de lista

As telas com tabela própria passaram para `TabelaPro` (colunas ajustáveis, preferência por usuário), com
cartões no celular, busca e estado vazio dos componentes de lista:

- **Formulários**: lista, gaveta com as abas Campos / Vínculos / Histórico. O histórico deixou de ser
  tabela (cabe na gaveta e no celular). "Tipo de OS vinculado" virou o seletor com cadastro inline e
  edição no contexto (referência).
- **Checklists de veículo**: lista e gaveta (antes, o editor abria no meio da página). A página usa o
  esqueleto `TelaCadastroApoio` e volta para a Frota.
- **Numeração de documentos**: uma linha por documento, com o campo e o Salvar na linha.
- **Padronização de digitação**: a prévia (de → para).

## Inativar, e não excluir

Formulário e modelo de checklist **não são apagados** — o servidor só os tira de uso. O botão passou a
se chamar "Inativar" e a confirmação diz o que acontece e o impacto:

- formulário: em quantas combinações de equipamento e tipo de OS ele é usado;
- checklist de veículo: quantas vezes já foi preenchido.

"Restaurar padrões" dos modelos de e-mail só cria os modelos que faltam (não sobrescreve o que a
empresa editou). O botão passou a dizer isso: "Carregar modelos que faltam".

## Tela limpa

Instrução saiu de parágrafo e foi para o ⓘ:

- E-mail: o passo a passo do Resend ("Como configurar").
- Banco Inter: "Como obter as credenciais".
- Numeração: a regra do mínimo. Impressão da OS: a regra das seções. Checklists: a regra das opções,
  que se repetia embaixo de cada item.

**Ficaram visíveis**, de propósito (segurança): o aviso de modo sandbox, a URL do webhook com o segredo
("copie agora"), o registro pendente no Inter e o texto do webhook de baixa automática.

## Feedback

Toda gravação avisa com **toast**; as caixas verdes de "salvo" dentro da tela saíram. O erro continua
na tela, perto do que falhou. Confirmações usam o diálogo próprio (nada de `confirm()` do navegador).

## Vocabulário

"Template" virou "modelo"; "Preview" virou "Prévia"; "Buscar" virou "Pesquisar"; "Remover" virou
"Excluir"; "Desativar" virou "Inativar"; mensagens de erro no mesmo tom ("Sem conexão. Tente de novo.").

## Telas tocadas

| Tela | Rota |
|---|---|
| Índice das Configurações | `/configuracoes` — conferido; sem alteração (os cartões já seguiam a permissão) |
| Formulários | `/configuracoes?secao=formularios` |
| Checklists de veículo | `/configuracoes/checklists-veiculo` |
| Numeração de documentos | `/configuracoes?secao=numeracao` |
| Padronização de digitação | `/configuracoes?secao=padronizacao` |
| E-mail transacional | `/configuracoes?secao=email` |
| Modelos de e-mail | `/configuracoes?secao=email-templates` |
| Dados da empresa | `/configuracoes?secao=empresa` (e Preferências, que é o mesmo componente) |
| Orçamentos e propostas | `/configuracoes?secao=orcamento` |
| QR Code | `/configuracoes?secao=qr-code` |
| Impressão da OS | `/configuracoes?secao=impressao-os` |
| Banco Inter | `/configuracoes?secao=banco-inter` |

## O que não entrou

- **Reativar** formulário e modelo de checklist inativados: a rota de leitura só devolve os ativos e não
  há rota de reativar. Daria para fazer sem banco (aba Inativos + Reativar), mas é função nova.
- Cadastro rápido do responsável técnico em Dados da empresa (é um colaborador com CREA; fica para a
  leva dos cadastros principais).
- Qualquer mudança no RBAC do painel, em pagamento ou em login.

## Testes

- `tests/unit/padronizacao-leva3-pg.test.ts` — rotas reais com PostgreSQL real: quem só visualiza leva
  403 em toda gravação e o banco inteiro fica idêntico; sem login, 401; inativar não apaga; carregar
  modelos padrão não sobrescreve.
- `tests/unit/padronizacao-leva3-ui.test.ts` — telas num DOM de verdade: sem a permissão não há botão
  de gravar; recusa do servidor não muda a tela; toast; padrão de lista; instrução no ⓘ.
- Testes existentes atualizados por mudança intencional: `numeracao-ui`, `impressao-os-ui`,
  `proposta-corporativa-ui` (a confirmação virou toast) e `inter-webhook-registro-ui` (gerar o webhook
  exige a permissão).

Prints em `docs/prints/padronizacao-leva3/` (`antes-*` e `depois-*`, desktop e celular, e as versões
`-sem-permissao`).
