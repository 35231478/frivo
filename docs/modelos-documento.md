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

## 9. Perguntas em aberto

1. **Qual preset de perfil, além do Administrador, nasce com `documentos.*`?** (A mesma pergunta
   ainda aberta da Admissão digital.)
2. **O EPI e o estoque.** Esta leva gera o documento e **não mexe em saldo**, como combinado. Ligar
   a entrega à baixa no estoque é a Fase 2.
