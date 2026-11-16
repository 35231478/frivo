# Documentos na ficha do colaborador

Um lugar só para os papéis de uma pessoa: o contrato de quem veio da plataforma anterior, o ASO, os
certificados de NR — e o que o próprio colaborador mandou pela **admissão digital**. Não existe lista
paralela: é a mesma tabela, a mesma seção e a mesma lista.

## Onde fica

**Colaboradores › (abrir a ficha) › aba Documentos.**

A aba exige a mesma permissão que a ficha completa já exigia — *Equipes / Colaboradores ›
gerenciar*. Quem não pode ver CPF e RG do colaborador também não vê os documentos dele.

## O que a lista mostra

| Coluna | O que é |
| --- | --- |
| Documento | O nome, e ao lado o formato e o peso ("PDF · 240 KB"), lidos dos bytes no envio |
| Categoria | A gaveta (contrato, ASO, NR-35…). Documento antigo mostra o rótulo como foi gravado |
| Validade | Em branco quando não vence; **Vencido há N dias** (vermelho) ou **Vence em N dias** (amarelo) |
| Enviado | Quando chegou e **quem pôs ali**: "Anexado pelo RH: Ana Souza" ou "Enviado na admissão" |

No celular, a mesma informação em cartões.

Quando a pessoa tem documento vencido, a **ficha inteira** avisa: uma faixa vermelha acima das abas,
clicável, que leva direto para a seção. É o mesmo cálculo da lista de colaboradores (um número só,
`DIAS_AVISO_VALIDADE = 30`) — a ficha e a lista não discordam sobre o que está vencido.

## As ações

| Ação | Onde | Permissão |
| --- | --- | --- |
| **Anexar documento** | Botão no topo da seção | Equipes › gerenciar |
| **Baixar** | ⋮ de cada linha | Equipes › gerenciar |
| **Editar categoria e validade** | ⋮ de cada linha | Equipes › gerenciar |
| **Excluir** | ⋮ de cada linha, em vermelho | **Equipes › excluir** |
| **Ver o contrato** | Linha do contrato assinado | Equipes › gerenciar + Admissão › gerenciar |

Excluir pede a permissão alta de propósito: é a mesma de inativar e de apagar o colaborador. Tirar o
contrato de alguém da ficha não é um clique de quem só edita cadastro.

### Excluir não apaga: marca

A confirmação diz exatamente isso. O documento sai da ficha, da lista e da conta de documentos
entregues da admissão — e **continua no banco**, com `excluido_em` e `excluido_por_id`. O arquivo
também fica. Dois cliques não reescrevem o rastro do primeiro.

O colaborador também pode apagar, pelo link da admissão, um arquivo que ele mesmo mandou (enquanto
não assinou). Também vira marca, não remoção — ali sem autor, porque quem apagou foi ele, pelo link,
e ele não é um usuário do sistema.

### Trocar o arquivo

Não se troca o arquivo de um documento já guardado. Para trocar, anexa-se o novo e exclui-se o
antigo: ficam os dois no banco, com data e autor. Trocar por baixo seria perder o original sem
rastro.

## As categorias

Guardadas em `lib/colaborador/documentos.ts` (`CATEGORIAS`), com id estável e rótulo separado —
mudar um rótulo não mexe no que já está gravado.

- **Contrato e registro**: contrato de trabalho, ficha de registro
- **Documentos pessoais**: documento pessoal, comprovante de residência, dados bancários, escolaridade
- **Segurança e medicina do trabalho**: ASO (exame), NR-10, NR-35, NR-13, ficha de EPI, integração
- **Outros**: CNH, outros

O grupo de segurança e medicina do trabalho existe porque é dele que sai a documentação que o cliente
pede antes de a equipe entrar na obra.

As gavetas que **costumam vencer** (ASO, NR-10, NR-35, NR-13, integração, CNH) estão marcadas: ao
anexar uma delas sem preencher a validade, a tela lembra, porque é a validade que alimenta os avisos
de vencimento e o pacote que vai ao cliente mais adiante.

**Documento antigo continua legível.** Antes desta leva a categoria era texto livre gravado na coluna
`tipo` ("CNH", "Diploma", "Certificado NR-35"). Esses documentos não foram reclassificados: sem
`categoria`, a tela mostra o `tipo` exatamente como estava. Nada foi adivinhado.

## A ligação com a admissão digital

O arquivo que o colaborador envia pelo link **já era gravado nesta mesma tabela** (desde o PR1 da
admissão), com `tipo` = o id do documento que a empresa pede ("rg", "ctps"…). O que faltava era a
ficha mostrar isso. Agora:

- o arquivo entra na lista da ficha com `origem = ADMISSAO` e uma categoria conhecida;
- o RH baixa por lá, como qualquer outro;
- excluir na ficha tira da conta de "documentos entregues" da admissão — uma verdade só;
- o **contrato assinado** aparece como uma linha da mesma seção, com **Ver o contrato**, que abre o
  texto congelado no momento da assinatura (mudar o modelo depois não altera este).

A `coluna tipo` continua sendo o protocolo da admissão. Editar a categoria de um documento vindo do
link muda só a `categoria` — mexer no `tipo` faria a admissão perder a conta do que já chegou.

## O defeito que esta leva conserta

Até aqui, salvar a ficha do colaborador fazia, na lista inteira de documentos:

```ts
documentos: { deleteMany: {}, create: [...] }
```

Ou seja: **toda salvada apagava e recriava todos os documentos da pessoa.** Perdia o id e a data de
envio de cada um, e apagava **sem rastro** o que o colaborador tivesse mandado pela admissão depois
de a tela ter carregado.

Os documentos saíram do cadastro. Cada arquivo tem a sua própria rota, e salvar o cadastro não mexe
mais nos papéis da pessoa.

## As rotas

| Rota | O que faz | Permissão |
| --- | --- | --- |
| `GET /api/tecnicos/[id]/documentos` | Lista os vivos (sem o arquivo, que é grande) | equipes.gerenciar |
| `POST /api/tecnicos/[id]/documentos` | Anexa; valida pelos BYTES; grava autor, formato e tamanho | equipes.gerenciar |
| `GET /api/tecnicos/[id]/documentos/[docId]` | Baixa (`?ver=1` abre na aba) | equipes.gerenciar |
| `PATCH /api/tecnicos/[id]/documentos/[docId]` | Categoria, nome e validade. Nunca o arquivo | equipes.gerenciar |
| `DELETE /api/tecnicos/[id]/documentos/[docId]` | Exclui com rastro | **equipes.excluir** |

Sem sessão, 401. Sem a permissão, 403. De outra empresa, 404 — nunca o arquivo. A busca é sempre
`{ colaborador: { empresaId } }`, nunca pelo id do documento sozinho.

O tipo do arquivo é decidido pelos **bytes** (um HTML com nome de PDF não passa), como em todo anexo
do sistema, e a resposta do download leva `nosniff` e sandbox: um HTML guardado como "documento"
nunca executa no navegador de quem baixa.

Tetos: 120 documentos vivos por colaborador; 8 MB por arquivo.

## O banco

`prisma/sql/2027-01-06_colaborador_documentos.sql` — aditivo e idempotente, para rodar **antes** do
merge.

Colunas novas em `colaborador_documentos`: `categoria`, `criado_por_id`, `excluido_em`,
`excluido_por_id`, `origem` (MANUAL | ADMISSAO), `arquivo_tipo`, `tamanho`; mais um índice por
`(colaborador_id, excluido_em)`. As chaves de autoria são `ON DELETE SET NULL`: apagar o usuário
perde o nome de quem anexou, nunca o papel da pessoa.

**A validade por documento não precisou de coluna**: `data_vencimento` já existia, e os filtros
"documento vencido / vencendo" da lista de colaboradores já liam essa mesma coluna.

## O que ficou de fora

A tela de **enviar documentação ao cliente** (selecionar colaboradores, montar o pacote, gerar o link
ou o zip) é uma frente separada. Esta leva prepara o terreno dela: todo documento agora tem
categoria, validade, origem, formato e tamanho.
