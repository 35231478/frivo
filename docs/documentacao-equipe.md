# Documentação da equipe para o cliente

Antes de a equipe entrar na obra, o cliente pede a documentação de cada pessoa: ASO, NR-10, NR-35,
ficha de EPI, contrato. Hoje isso é uma pasta no Google Drive, montada à mão, com link que nunca
expira e ninguém sabendo o que foi para quem. Esta funcionalidade monta o pacote a partir do que
**já está na ficha do colaborador** e o entrega por link com prazo, zip ou e-mail — com registro.

> O briefing original (`modulo-documentos-equipe-e-dossie-cliente.md`, Peça 2) não está no
> repositório. Este documento foi escrito a partir do pedido da leva; se o briefing trouxer algo
> que não está aqui, vale o briefing.

O corte: **PR1 é o motor e o banco** (seções 1 a 11); **PR2 são as telas** — montar o pacote, o
histórico e a página que o cliente abre (seção 12).

## 1. Por que isto não é um módulo novo

| O que já existia | O que foi reusado |
| --- | --- |
| `colaborador_documentos` (gaveta, validade, origem, exclusão com rastro) | O pacote **aponta** para esses arquivos. Nada é copiado. |
| `lib/zip.ts` (zip com pastas, sem dependência) | O zip do pacote, o da empresa e o do cliente. |
| `lib/email.ts` (modelo por empresa, "responder para", registro do envio) | O modelo novo "Documentação da equipe", editável na tela de e-mails que já existe. |
| Link público da admissão digital (token na linha, validade, limite por IP) | O mesmo padrão: token de 32 bytes na linha do envio, `expira_em`, e o limitador com um contexto novo. |
| `situacaoValidade` (a conta de vencido da ficha, da lista e do sino) | O bloqueio de vencido usa a **mesma** conta — o pacote não discorda da ficha. |
| Permissões por ação no JSON do perfil | Uma ação nova, `documentos.enviar`. Sem SQL. |

## 2. O fluxo

1. **Cliente** (e, se quiser, o contrato).
2. **Colaboradores**: à mão, ou puxando a sugestão — os técnicos fixos dos contratos ativos, quem
   executou ordem de serviço do cliente nos últimos 12 meses, ou os membros de uma equipe. É
   sugestão; ex-colaborador não é sugerido.
3. **Tipos de documento**: já vem marcado o que o cliente pede para liberar a entrada — segurança e
   medicina do trabalho (ASO, NRs, ficha de EPI, integração). Contrato e documento pessoal, só se
   a pessoa marcar.
4. **Prévia**: o que entra, o que falta e o que está vencido — antes de gravar qualquer coisa.
5. **Entrega**: link, zip ou e-mail.

## 3. O que pode e o que não pode sair

- **Nunca**: advertência/suspensão e dados bancários. Não são oferecidos na tela e o servidor
  recusa mesmo que a tela mande.
- **Documento antigo sem gaveta** (de antes da coluna `categoria`) não entra: o sistema não
  reclassifica por adivinhação. Basta classificar o documento na ficha.

## 4. Vencido não sai

Para cada colaborador × tipo marcado:

| Situação | O que acontece |
| --- | --- |
| Documento em dia, ou sem validade | Entra. |
| Vence nos próximos 30 dias | Entra, e a prévia avisa. |
| **Vencido, sem renovação** na mesma gaveta | **Segura o pacote** (409, com a lista). |
| Vencido, **com** renovação em dia na mesma gaveta | Fica de fora, sem alarde — vai o novo. |
| Nenhum documento daquele tipo | "Falta": a prévia mostra, e a pessoa confirma para gerar assim mesmo. |

Não existe "enviar mesmo vencido". As saídas são renovar o documento ou tirar o colaborador do
pacote — a decisão fica com quem envia, e o histórico mostra o que foi.

"Renovação" é documento da mesma gaveta, em dia **e com data de vencimento**: um papel sem validade
na gaveta do ASO não prova que o exame foi refeito.

A regra vale também **depois**: um pacote antigo cujo documento venceu não ganha link novo, não
baixa em zip e não é reenviado por e-mail — monta-se um pacote novo. O que já estava no link e
venceu durante o prazo continua visível, **marcado como vencido**.

## 5. As três saídas

- **Link** — o cliente abre sem login e baixa arquivo por arquivo ou tudo em zip. Prazo de 3, 7,
  15 ou 30 dias (padrão 7; nunca eterno). Somente leitura. Revogável.
- **Zip** — o pacote em pastas, para quem está montando. Não gera link.
- **E-mail** — o corpo leva o **link**, nunca os anexos. Os destinatários vêm do cadastro do
  cliente (contatos operacionais; o principal em "Para", os demais em cópia) e são editáveis: mais
  de um em "Para", cópia, e cópia para quem está enviando. "Responder para" é o que a empresa
  configurou no e-mail transacional e, sem isso, o e-mail da empresa — a resposta do cliente chega
  na empresa, não no remetente do sistema. O texto é o modelo **"Documentação da equipe"**,
  editável por empresa em Configurações › E-mail transacional.

As pastas do pacote: uma por colaborador (padrão), uma por tipo, ou colaborador e, dentro, tipo. O
nome do arquivo sempre diz de quem é e o que é.

## 6. Vários clientes de uma vez

A renovação anual manda a documentação para vários clientes. Por dentro é **um envio por
cliente**: cada um com o seu token, os seus arquivos e os seus destinatários. Não existe caminho no
código em que dois clientes dividam um link ou um e-mail. Um cliente que não pode ser enviado
(documento vencido, sem e-mail) não segura os outros — a resposta diz, cliente a cliente, o que
saiu e o que ficou, e por quê. O mesmo cliente duas vezes no lote é recusado, e zip não entra em
lote.

## 7. LGPD

- **Lista fechada.** O envio grava os arquivos do pacote (`documentacao_envio_itens`). O link serve
  **só** essas linhas: outro colaborador, outro tipo ou um documento anexado depois não aparecem.
- **O id da URL é o do item do envio**, não o do documento. Trocar o id não alcança arquivo de fora
  do pacote.
- **Arquivo excluído da ficha some do link** (lista, download e zip).
- **Prazo curto e revogação**: o link morre na hora, o histórico fica.
- **Registro de acesso**: cada abertura, cada arquivo baixado e cada zip, com IP e navegador.
- **Limite por IP**: só token recusado conta. Quem tem o link bom baixa à vontade; varrer tokens no
  escuro acaba em 429.
- Link que **não existe** dá uma frase genérica (404): nada confirma a quem chuta que ele quase
  acertou. Link que **existiu** e não vale mais diz o motivo (410) — "expirou em tal dia" ou "foi
  desativado pela empresa" — e a quem pedir outro. Para cair ali é preciso ter o token de verdade:
  é o cliente, e ele precisa saber o que fazer. (No PR1 as três situações davam a mesma frase; o
  motivo entrou no PR2, a pedido.) O motivo nunca leva dado do pacote.

## 8. Permissão

`documentos.enviar` ("Enviar ao cliente"), no módulo Documentos do colaborador. É ação própria:
gerar documento na ficha (`criar`), cuidar dos modelos (`gerenciar`) ou gerenciar colaboradores não
dão o direito de mandar documentação para fora da empresa. **Só o Administrador nasce com ela.**

## 9. As rotas

| Rota | O que faz |
| --- | --- |
| `GET /api/documentacao/sugestoes` | quem atende o cliente (ou a equipe), os e-mails do cadastro e os contratos ativos dele |
| `POST /api/documentacao/previa` | o que entra, o que falta, o que venceu — sem gravar |
| `GET /api/documentacao/envios` | o histórico: busca pelo cliente (`q`), situação do link (`situacao`), as vias usadas e quando o cliente abriu e baixou |
| `POST /api/documentacao/envios` | monta o pacote de um cliente e entrega (LINK, ZIP ou EMAIL) |
| `POST /api/documentacao/envios/lote` | vários clientes: um envio por cliente |
| `GET /api/documentacao/envios/[id]` | o envio, os arquivos e a linha do tempo |
| `GET /api/documentacao/envios/[id]/zip` | o zip, para a empresa |
| `POST /api/documentacao/envios/[id]/link` | gera o link (ou um novo no lugar do que morreu) |
| `POST /api/documentacao/envios/[id]/revogar` | revoga o link |
| `POST /api/documentacao/envios/[id]/email` | manda (ou manda de novo) o e-mail |
| `GET /api/publico/documentacao/[token]` | **público**: a lista do pacote |
| `GET /api/publico/documentacao/[token]/arquivo/[itemId]` | **público**: um arquivo |
| `GET /api/publico/documentacao/[token]/zip` | **público**: o pacote em zip |

Internas: sem sessão 401, sem a permissão 403, de outra empresa 404. Públicas: 404 para link que
não existe, 410 (com o motivo) para expirado ou revogado, 429 no limite.

## 10. O banco

`prisma/sql/2027-01-08_documentacao_equipe.sql` — aditivo e idempotente, três tabelas novas:

- **`documentacao_envios`** — o pacote: cliente (com o nome copiado), contrato, gavetas,
  organização das pastas, o link (`token`, `expira_em`, `revogado_em/por`), o lote e quem enviou.
- **`documentacao_envio_itens`** — a lista fechada: um arquivo por linha, com colaborador, gaveta,
  nome, caminho e validade copiados.
- **`documentacao_envio_eventos`** — a linha do tempo: criado, link gerado, zip baixado, e-mail
  enviado ou não, revogado, e o que o cliente fez pelo link.

Apagar o cliente, o contrato, quem enviou, o colaborador ou o arquivo **não apaga** o registro de
que aquele pacote foi enviado (`ON DELETE SET NULL`, com os dados copiados).

## 11. Perguntas em aberto

1. **Quem, além do Administrador, nasce com `documentos.enviar`?** (A mesma pergunta das levas de
   Admissão e Modelos.)
2. **"Enviar mesmo vencido", com justificativa?** Hoje não existe: vencido segura. Se a operação
   precisar de exceção, é uma decisão a tomar — não foi chutada.
3. **Dados bancários e advertência ficam de fora para sempre?** Foi a postura conservadora.
4. **Contrato de trabalho e documento pessoal** são enviáveis, mas não vêm marcados. Devem ficar
   de fora de vez?
5. **O que venceu durante o prazo do link** continua baixável, marcado como vencido. A alternativa
   é esconder — o que deixa o cliente sem saber por que o ASO sumiu.
6. **A validade padrão é 7 dias** e o teto é 30. Serve?
7. **WhatsApp** não é uma via nesta leva (o pedido foi link, zip e e-mail).

## 12. As telas (PR2)

Sem schema novo. Três telas, todas em cima das rotas da seção 9.

### 12.1 Onde fica

**Equipes › Documentação da equipe** (`/documentacao-equipe`). O item só aparece no menu para quem
tem "Documentos › Enviar ao cliente". A rota não tem módulo de "visualizar" no middleware — quem só
tem a ação de enviar entra — e por isso **cada página confere a permissão sozinha** e manda para
`/sem-permissao`; as rotas recusam com 403 de qualquer jeito.

### 12.2 Histórico (`/documentacao-equipe`)

Lista no padrão da casa (busca pelo cliente, filtro pela situação do link, colunas escolhíveis,
cartões no celular). Colunas: cliente, pacote (arquivos e colaboradores), via, link (ativo,
expirado, revogado, sem link), **recebimento** (quando o cliente abriu e quando baixou), enviado
em, por quem.

O **⋮ de cada linha** só oferece o que a rota aceitaria:

| Ação | Quando aparece |
| --- | --- |
| Ver o envio e a linha do tempo | sempre |
| Copiar o link | link ativo |
| Baixar o zip | sempre (a rota recusa se algo venceu depois do envio, e a razão aparece) |
| Enviar por e-mail / Enviar o e-mail de novo | sempre; sem link ativo, gera um link novo junto |
| Gerar um link novo | sem link, expirado ou revogado |
| Revogar o link | link ativo; pede confirmação |

A **linha do tempo** (gaveta lateral) separa o que a empresa fez (criou, gerou link, baixou zip,
mandou e-mail, revogou) do que o **cliente** fez pelo link (abriu, baixou um arquivo, baixou o
pacote) — estes com IP e navegador. É a prova de recebimento.

### 12.3 Novo envio (`/documentacao-equipe/novo`)

Três passos:

1. **Cliente e colaboradores.** Escolhido o cliente, a tela traz quem atende a ele já marcado, com
   o porquê em cada linha (técnico do contrato, atendeu nos últimos 12 meses). Dá para estreitar por
   contrato, puxar uma equipe e acrescentar alguém pelo nome.
2. **Documentos e pastas.** Segurança e medicina do trabalho marcada; contrato e documento pessoal
   desmarcados; advertência e dado bancário nem aparecem. A organização das pastas é a do zip e a
   da página do cliente.
3. **Prévia e envio.** A prévia mostra o que entra, na estrutura de pastas escolhida.
   - **Vencido segura**: o botão de enviar trava em qualquer saída e não existe "enviar assim
     mesmo". Cada pessoa com vencido tem as duas saídas na linha: *Abrir a ficha* (renovar) e
     *Tirar do pacote* (refaz a prévia sem ela).
   - **Falta** (a pessoa não tem aquele tipo) não segura, mas pede a marcação "conferi e quero
     enviar sem esses documentos".
   - **Saída**: *Gerar link* (com prazo), *Baixar zip* ou *Enviar e-mail* (Para e Cópia vêm do
     cadastro do cliente e são editáveis; há a cópia para quem envia).

**Lote** fica em *Avançado*: vários clientes, cada um com a sua lista de colaboradores (sugerida e
ajustável), a sua prévia e os seus destinatários. Sai por link ou e-mail (zip não entra em lote).
Um cliente segurado fica de fora sem segurar os outros, e o resultado diz, cliente a cliente, o
link de cada um, o que houve com o e-mail, ou por que não saiu.

A tela nunca decide sozinha: a prévia e o envio são do servidor. **Quando ele recusa, a razão dele
aparece e a tela não anda para o resultado** — e se a recusa foi por vencido (venceu entre a prévia
e o clique), a prévia é refeita.

### 12.4 A página do cliente (`/documentacao/[token]`)

Sem login, feita para o celular: o cliente, a empresa, até quando o link vale, **Baixar tudo
(zip)** e cada arquivo com *ver* e *baixar*, em cartões na organização que a empresa escolheu.
Abrir a página registra o acesso (é o "cliente abriu" do histórico).

Link que não serve não mostra erro técnico: "Link expirado" (com a data e a quem pedir), "Link
desativado", "Link indisponível" (o genérico, para o que nunca existiu) ou "Aguarde um pouco" (o
limite por IP).

### 12.5 Onde está cada botão

| Botão | Tela |
| --- | --- |
| **Montar** o pacote | Histórico › *Novo envio* → `/documentacao-equipe/novo`, passos 1 e 2 |
| **Prévia** | Novo envio, passo 3 (*Ver a prévia*) — de um cliente, ou uma por cliente no lote |
| **Gerar link** | Novo envio, passo 3 (saída *Gerar link*); Histórico › ⋮ › *Gerar um link novo* |
| **Baixar zip** | Novo envio, passo 3 (saída *Baixar zip*) e no resultado; Histórico › ⋮ › *Baixar o zip*; página do cliente (*Baixar tudo*) |
| **Enviar e-mail** | Novo envio, passo 3 (saída *Enviar e-mail*); Histórico › ⋮ › *Enviar por e-mail* |
| **Lote** | Novo envio, passo 1 › *Avançado* › *Enviar para vários clientes* |
| **Reenviar** | Histórico › ⋮ › *Enviar o e-mail de novo* |
| **Revogar** | Histórico › ⋮ › *Revogar o link* |
| Copiar o link | Resultado do envio; Histórico › ⋮ › *Copiar o link* |
| Linha do tempo | Histórico › ⋮ › *Ver o envio e a linha do tempo* |
