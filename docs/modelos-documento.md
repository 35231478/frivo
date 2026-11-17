# Modelos de Documento

O motor único que gera os papéis do RH a partir de um modelo da empresa: **ficha de entrega de
EPI**, **termo de responsabilidade**, **advertência/suspensão** e **aditivo de contrato**.

> **Estado:** PR1 (este) traz o banco, as regras e o servidor — sem tela. O PR2 traz as telas
> (Configurações › Modelos de documento, e o "Gerar documento" na ficha do colaborador). O PR3
> fecha os tipos com peso e o acabamento.

## 1. Por que isto não é um módulo novo

O motor **já existia com um tipo só**: o contrato da admissão digital. Um texto da empresa com
campos entre chaves, preenchido com os dados da pessoa, assinado com prova (nome digitado, foto,
IP, navegador, hora) e guardado nos Documentos da ficha.

Esta leva generaliza esse caminho. Três peças saíram da admissão para a casa comum, e os testes do
contrato e do documento do PMOC são a prova de que nada mudou no meio do caminho:

| Peça | Era | Virou |
| --- | --- | --- |
| Trocar `{{campo}}` pelo valor, listar usados e desconhecidos | `montarContrato` em `lib/admissao/admissao.ts` | `lib/texto/modelo.ts` — a admissão lê daqui |
| Bloco de "rótulo em cima, valor embaixo" em duas colunas | função solta em `admissao-pdf.ts` | método `campos()` de `lib/pdf/desenho.ts` |
| Foto da assinatura dentro do PDF (tipo lido dos bytes) | função solta em `admissao-pdf.ts` | `lib/pdf/imagem.ts` |

E três coisas **não precisaram de nada novo**:

- **a gaveta e a validade**: `colaborador_documentos` já tem categoria, origem, data de vencimento
  e exclusão com rastro. O papel gerado cai ali como qualquer outro — sem lista paralela;
- **o aviso de vencimento**: a ficha e a lista de colaboradores já destacam "vencido" e "vence em
  breve". A validade do modelo vira a data de vencimento do anexo, e o aviso passa a valer sozinho;
- **o CRUD**: o kit de cadastros padronizados (lista, busca, abas, ações em massa, validação que
  recusa campo desconhecido) atende o cadastro dos modelos — `"modelos-documento"` é uma entrada
  declarativa em `lib/cadastros/registro.ts`.

## 2. Os quatro tipos

| Tipo | Gaveta na ficha | Lista de itens | Permissão | Campos que o usuário completa |
| --- | --- | --- | --- | --- |
| **Ficha de entrega de EPI** | Ficha de EPI | **exige** | criar | data da entrega |
| **Termo de responsabilidade** | Termo de responsabilidade | permite | criar | entrega, previsão de devolução |
| **Advertência / suspensão** | Advertência e suspensão | não | **disciplinar** | data do ocorrido, motivo, medida, dias |
| **Aditivo / atualização de contrato** | Contrato de trabalho | não | criar | a partir de, o que muda, como era, como fica |
| Outro documento | Outros | permite | criar | — |

O tipo decide a gaveta, se a assinatura é pedida e **quem pode gerar**. O modelo pode escolher
outra gaveta; sem escolher, vale a do tipo.

## 3. Os campos

**O sistema preenche, não inventa.** São dezenove campos vindos do cadastro da pessoa e da empresa
(`{{nome}}`, `{{cpf}}`, `{{rg}}`, `{{pis}}`, `{{ctps}}`, `{{endereco}}`, `{{cargo}}`, `{{cbo}}`,
`{{salario}}`, `{{jornada}}`, `{{admissao}}`, `{{contratoEm}}`, `{{empresa}}`, `{{empresaCnpj}}`,
`{{cidade}}`, `{{data}}`…), mais os campos próprios do tipo, que quem gera completa na hora.

Campo que o sistema **não conhece fica visível no texto**, exatamente como foi escrito: é erro de
quem escreveu o modelo, e esconder só atrasaria a descoberta. A tela mostra a lista dos conhecidos
em verde e avisa dos outros — o mesmo comportamento que a configuração da admissão já tinha.

Campo **obrigatório do tipo** em branco não gera papel pela metade: a rota recusa dizendo qual
falta.

## 4. A lista de itens (a ficha de EPI)

`item · CA · quantidade · data de entrega`, numa tabela que o PDF repete o cabeçalho quando quebra
a folha.

**No EPI o CA é obrigatório.** É o Certificado de Aprovação que transforma a ficha em prova de que
o equipamento entregue era certificado (NR-6) — e a mensagem de erro diz o que fazer quando o item
não tem CA: material sem CA não é EPI, vai num termo de responsabilidade.

## 5. Gerar, assinar, guardar

1. **Gerar** — o texto é preenchido e **congelado**: mudar o modelo depois não altera o papel que
   já foi entregue, pela mesma razão que o contrato da admissão congela na assinatura.
2. **Assinar** — presencial, no aparelho de quem entrega: a pessoa digita o nome e tira uma foto; o
   servidor grava IP, navegador e hora. **É a mesma prova da admissão digital**, sem mecanismo novo.
3. **Guardar** — só então o PDF vira anexo na seção Documentos da ficha, com a categoria do tipo e
   a validade do modelo.

Enquanto não está assinado, o papel existe no histórico e o PDF sai com a tarja **PRÉVIA — AINDA
NÃO ASSINADO**, no alto. Documento com cara de final e sem assinatura é pior do que documento
nenhum. Modelo que não pede assinatura (um aditivo arquivado, por exemplo) já nasce guardado.

**Cancelar não apaga**: guarda quem, quando e por quê, e tira o anexo da ficha com o mesmo rastro
de qualquer exclusão de documento. Advertência errada se cancela — não se faz sumir.

## 6. A permissão

Módulo próprio, ao lado da Admissão digital, porque papel de pessoa é dado sensível:

| Ação | O que libera |
| --- | --- |
| **Documentos do colaborador › criar** | gerar, assinar, cancelar e ver o histórico |
| **Documentos do colaborador › gerenciar** | criar, editar e inativar os **modelos** |
| **Documentos do colaborador › disciplinar** | gerar **e ver** advertência e suspensão |

Quem não tem `disciplinar` não vê a advertência nem no histórico (ela some da lista) nem no PDF
(404, não 403: quem não pode ver não precisa saber que ela existe).

Como na admissão, **só o Administrador nasce com estas permissões**. Qual preset além dele deve
nascer com elas é pergunta para o Zé.

## 7. As rotas

| Rota | O que faz |
| --- | --- |
| `GET /api/tecnicos/[id]/documentos-gerados` | o histórico da pessoa |
| `POST /api/tecnicos/[id]/documentos-gerados` | gera o papel a partir de um modelo |
| `POST /api/tecnicos/[id]/documentos-gerados/previa` | monta a prévia sem gravar nada |
| `POST /api/documentos-gerados/[id]/assinar` | a assinatura presencial, com a prova |
| `POST /api/documentos-gerados/[id]/cancelar` | cancela com razão, tira o anexo |
| `GET /api/documentos-gerados/[id]/pdf` | o PDF (`?ver=1` abre na aba) |

Sem sessão 401, sem a permissão 403, de outra empresa 404 — nunca o arquivo. O CRUD dos modelos usa
a rota do kit de cadastros (`/api/cadastros/modelos-documento`).

## 8. O banco

Duas tabelas novas (`prisma/sql/2027-01-07_modelos_documento.sql`, aditivo e idempotente):

- **`documento_modelos`** — o modelo da empresa: nome (único por empresa), tipo, texto, gaveta, se
  tem itens, validade em dias, se pede assinatura, ativo.
- **`documento_emitidos`** — o papel gerado: tipo e título copiados do modelo, texto congelado, os
  valores completados, os itens, a prova da assinatura, o anexo que ele virou, e o cancelamento.

Apagar o modelo, o usuário que gerou ou o próprio arquivo **não apaga** o registro de que o
documento existiu (`ON DELETE SET NULL`); apagar a empresa ou o colaborador leva tudo junto
(`CASCADE`), que é o que já acontece com o resto da ficha.

## 9. As telas (PR2)

O motor do PR1 só ganha valor quando alguém consegue usá-lo sem ler documentação. São três lugares,
e nenhuma tela nova fora deles.

### Configurações › Modelos de documento

Mora na gaveta de Configurações, aba **Conta**, grupo "Acesso e pessoas", ao lado de Admissão
digital — atrás de `documentos.gerenciar`. É o kit de cadastros padrão (`CadastroPadrao`), com
Ativos/Inativos/Todos, busca, Novo modelo, o lápis de editar e o botão de inativar/reativar. Sem
ação em massa: modelo de documento é um punhado por empresa, e selecionar vários não resolve nada
(declarar `massa: true` sem registrar a entidade em `lib/acoes-massa/acoes.ts` derruba a lista
inteira — tem guard puro para isso em `tests/unit/cadastros-registro.test.ts`).

O editor é próprio (`editor-modelo-documento.tsx`), porque o texto com campos pede mais do que um
formulário genérico:

- **o painel de campos** mostra tudo que o sistema sabe preencher; o que o texto usa fica **verde**,
  o que sobra fica neutro — dá para escrever o modelo olhando a lista, sem decorar nome de campo;
- **campo que o sistema não conhece vira aviso** na hora (`{{supervisor}}` → "o sistema não preenche
  este campo"), e o texto não é tocado: quem escreveu corrige;
- **a lista de itens acompanha o tipo** — a ficha de EPI sempre tem (não dá para desligar), a
  advertência nunca tem;
- gaveta na ficha, validade em dias e "pede assinatura" ficam no mesmo editor, com a explicação ao
  lado do campo.

### Ficha do colaborador › Documentos

Ao lado de **Anexar documento** nasce **Gerar documento**, atrás de `documentos.criar`. Sem a
permissão o botão não existe — e a rota recusa de todo jeito. A advertência só aparece no seletor de
quem tem `documentos.disciplinar`.

O diálogo tem dois passos, e só mostra o segundo quando ele existe:

1. **montar** — modelo, os campos que *aquele* modelo usa (campo de data já nasce com hoje), a
   tabela de itens quando o tipo tem, e **Ver a prévia**: o texto preenchido de verdade, com a tarja
   "PRÉVIA — AINDA NÃO ASSINADO" no PDF e **sem gravar nada**;
2. **assinar** — nome digitado e foto tirada na hora (a mesma `CapturaFoto` da admissão), com o
   servidor gravando IP, navegador e hora. Dá para fechar e assinar depois: o papel fica aguardando.

### A linha do papel, na mesma lista

O papel gerado não cria uma seção à parte: entra na tabela de Documentos que já existe. Enquanto
não foi assinado aparece com o selo **Aguardando assinatura** e as ações Baixar (a prévia), Assinar
e Cancelar. Depois de assinado vira anexo de verdade — com a validade do tipo e a origem **"Gerado
por modelo"** — e no lugar de "Excluir" oferece **Cancelar**, que pede a razão, tira o anexo da
ficha e **não apaga o registro**.

### Telas × botões

| Tela | Botão | Permissão |
| --- | --- | --- |
| Configurações › Modelos de documento | Novo modelo, Editar, Inativar/Reativar | `documentos.gerenciar` |
| Ficha › Documentos | Gerar documento | `documentos.criar` |
| Diálogo de gerar | Ver a prévia, Gerar | `documentos.criar` (advertência: + `disciplinar`) |
| Diálogo de assinar | Assinar, Assinar depois, Ver o PDF | `documentos.criar` |
| Linha do papel pendente | Baixar, Assinar, Cancelar | `documentos.criar` |
| Linha do papel assinado | Baixar, Cancelar | `documentos.criar` |

Prints de desktop e celular em `docs/prints/modelos-documento/`.

### O que os prints acharam (e virou conserto)

Abrir as telas no navegador de verdade achou cinco defeitos que teste de DOM não via: a lista de
Configurações caindo inteira por causa do `massa: true`; a data digitada entrando crua no texto
("entrega em 2026-11-17"); a data pré-preenchida em UTC (depois das 21h já mostrava amanhã); o papel
gerado se apresentando como "Anexado pelo RH"; e a coluna Tipo cortada nos 140px fixos.

## 10. O papel pronto (PR3)

O PR1 fez o motor e o PR2 as telas. Esta leva fecha o que o papel mostra — é o que vai para a mão
do colaborador, para o arquivo da empresa e, se o dia for ruim, para a fiscalização.

### O quadro de dados, por tipo

Todo papel ganhou uma seção **Dados do documento**: os campos que a pessoa preencheu na hora de
gerar, cada um com o seu rótulo, na ordem em que o tipo os declara. Antes, o que a empresa não
tivesse citado no texto **sumia do papel** — a data do ocorrido de uma advertência, a previsão de
devolução de um termo.

| Tipo | O que o quadro leva |
| --- | --- |
| Ficha de EPI | Data da entrega (e a tabela de itens com o CA) |
| Termo de responsabilidade | Data da entrega, previsão de devolução (e o material sob guarda) |
| Advertência / suspensão | Data do ocorrido, medida aplicada, dias de suspensão, e o **motivo** inteiro |
| Aditivo | A partir de, o que muda, **como era → como fica** |

O texto da empresa continua sendo a narrativa; o quadro é o fato, no mesmo lugar em todo papel do
mesmo tipo. Campo em branco não vira linha vazia: simplesmente não entra. Campo de texto longo (o
motivo) não cabe em meia coluna — sai embaixo, inteiro.

### A tabela de itens

Quatro colunas: **item**, **nº do CA**, **qtd.** e **entrega**. A largura do item é o que sobra
(descrição é o que mais cresce); o CA tem coluna própria e nunca quebra, porque é por ele que a
fiscalização começa. O cabeçalho se repete quando a tabela vira a folha, e no termo a mesma tabela
se chama **Material sob guarda** — lá não se entrega EPI.

Um cabeçalho que não cabe na coluna vaza por cima da vizinha sem aparecer no texto extraído do PDF.
Por isso `colunasItens(util)` é exportada e **medida com a fonte de verdade** em
`tests/unit/documentos-pdf-exemplos.test.ts`.

### Os modelos-exemplo

`lib/documentos/exemplos.ts` traz **um texto de partida por tipo**, com os campos já no lugar.
Quando a empresa abre um modelo novo e o texto está em branco, o editor oferece o exemplo do tipo
escolhido, com o aviso: *"Texto de partida, para editar. Revise com o seu contador ou advogado: o
sistema preenche os campos, não confere o conteúdo."* Um clique traz o texto (e o nome sugerido,
se ainda estiver vazio); com texto escrito o convite some, para ninguém perder trabalho.

O Frivo não valida cláusula — preenche campo. Os guards garantem o que é nosso: nenhum exemplo cita
campo que o sistema não conhece, e todo exemplo usa os campos obrigatórios do seu tipo (senão o
papel nasceria travado na hora de gerar).

### O acabamento

- **O contador da aba Documentos soma o papel que aguarda assinatura.** Era pendência invisível:
  quem olha a ficha vê "Documentos 2" e sabe que tem coisa esperando.
- **O que é guardado em `valores`** passou a ser só o que o tipo conhece, aparado e com teto
  (`valoresDoTipo`) — antes ia o JSON cru que a tela (ou um cliente da API) mandasse.
- **O rodapé do PDF não escreve mais por cima de si mesmo**: com nome de empresa longo, a linha da
  esquerda passava por cima do "Emitido em" do meio. Agora é cortada com reticências. Vale para
  todo PDF da casa (PMOC, Ficha de Admissão, contrato).
- **O cabeçalho de coluna numérica** fica alinhado à direita, como o número de baixo.
- **A foto da assinatura não é esticada**: uma imagem pequena virava um bloco de 190pt e empurrava
  o papel para uma segunda folha.

Prints de desktop e celular em `docs/prints/modelos-documento-pr3/`.

## 11. Perguntas em aberto

1. **Qual preset de perfil, além do Administrador, nasce com `documentos.*`?** (A mesma pergunta
   ainda aberta da Admissão digital.)
2. **O EPI e o estoque.** Esta leva gera o documento e **não mexe em saldo**, como combinado. Ligar
   a entrega à baixa no estoque é a Fase 2.
