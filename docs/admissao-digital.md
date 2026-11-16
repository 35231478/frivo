# Admissão digital — coletor, contrato, assinatura e orientações

O colaborador preenche a própria ficha por um link, manda os documentos, assina o contrato e o RH
baixa tudo pronto para o contador. Este documento é o levantamento (o que já existia × o que
entrou), o desenho do fluxo e o mapa de telas × botões — para conferir que nada ficou solto.

## 1. Levantamento: o que já existia e foi reaproveitado

| Precisava de | Já existia em | Como entrou na admissão |
| --- | --- | --- |
| Link público com token e prova de quem agiu | `lib/os/aceite-server.ts` — aceite da OS (`randomBytes`, nome + IP + navegador + data/hora, troca atômica de situação) | O mesmo desenho, com token de 32 bytes (o aceite usa 24) e uma selfie a mais. A prova da assinatura são as mesmas quatro colunas |
| Cadastro do colaborador | `tecnicos` (modelo `Tecnico`) e a ficha em `/colaboradores` | O pré-cadastro cria a linha; o que o colaborador preenche VOLTA para esse cadastro. Nenhuma tabela paralela de "pessoa" |
| Anexos (documentos) | `lib/anexos-server.ts` (`validarDataUrl`: tipo decidido pelos BYTES, bloqueia HTML/SVG/script) e `colaborador_documentos` | Cada documento pedido vira uma linha em `colaborador_documentos` com `tipo` = id do documento da empresa |
| E-mail transacional | `lib/email.ts` + `lib/email-templates.ts` (Resend por empresa, templates editáveis, `email_log`) | Dois templates novos: `ADMISSAO_CONVITE` e `ADMISSAO_CODIGO` |
| Limite anti-abuso em rota pública | `lib/acesso/limite.ts` (`TipoTentativa`, chave em hash, falha de banco não bloqueia) | Dois tipos novos: `ADMISSAO_PUBLICA` e `ADMISSAO_CODIGO` |
| Permissão por módulo e ação | `lib/permissoes.ts` + `exigirPermissao` | Módulo novo `admissao` com a ação `gerenciar`, na seção Equipe |
| Rota pública liberada sem login | `middleware.ts` (`/api/publico/`, `/orcamento/`, `/qr/`) | `/admissao/` entrou na lista (a barra final não libera `/admissoes`, que é do RH) |
| PDF | `pdf-lib` (documento do PMOC) | Fica para o PR3 (Ficha de Admissão no formato do eSocial + zip) |

Nada foi reconstruído. O que não existia: a tabela do convite, a configuração por empresa, os
dependentes e os campos que o eSocial pede e o cadastro não guardava.

## 2. O fluxo

```
RH: pré-cadastro (nome + CPF + cargo + salário) → gera o convite
      ↓ link por e-mail / WhatsApp
CONVIDADO → PREENCHENDO → AGUARDANDO_ASSINATURA → ASSINADO → ENVIADO_CONTADOR → ADMITIDO
      ↘ CANCELADA (com razão, de qualquer ponto vivo)     ↘ EXPIRADA (prazo ou "invalidar")
```

- **A situação mora só em `admissoes`.** O cadastro do colaborador não ganhou um segundo lugar para
  a mesma verdade: a ficha dele lê a situação pela admissão.
- **O colaborador pré-cadastrado entra INATIVO** e fora do quadro. Só `ADMITIDO` o torna ativo —
  antes disso ele não aparece como gente disponível na operação.
- **Expirada volta ao jogo** quando o RH reenvia (prazo novo, mesmo token: quem já tinha o link não
  fica com dois).
- **Cancelar nunca apaga.** Muda a situação e guarda a razão, quem e quando. Depois de cancelar, o
  RH pode abrir outra admissão para a mesma pessoa; a cancelada fica no histórico.

## 3. Decisões tomadas

1. **O CPF do convite não é mostrado inteiro no link** (`***.982.247-**`). O colaborador digita o
   dele e o servidor confere: é a identificação de quem abriu o link, e um link vazado não entrega
   o CPF de ninguém.
2. **O nome é o único campo pré-preenchido.** O resto é de quem preenche — o sistema não chuta.
3. **E-mail é verificado por código** (6 números, 15 minutos, 5 tentativas). O banco guarda só o
   HASH do código. Trocar o e-mail depois derruba a verificação. Quem não tem e-mail conclui sem
   ele; quem digitou um tem de confirmar.
4. **A selfie é obrigatória para assinar.** É a prova que a assinatura digital exige, junto com
   nome, IP, navegador e data/hora.
5. **Sem modelo de contrato da empresa, não há assinatura.** O sistema preenche `{{campos}}`, não
   escreve cláusula. A tela de configuração avisa quando o modelo usa um campo que o sistema não
   conhece.
6. **O limite da rota pública conta só o token RECUSADO** (não existe, venceu). Quem tem um link
   bom preenche à vontade: o limite existe para impedir varredura de tokens, não para atrapalhar
   quem está trabalhando.
7. **Quem gerou o convite é avisado por e-mail quando a admissão é assinada** (`avisarRh`), depois
   da resposta — falha de e-mail não derruba a assinatura. O sino do RH (`contarAdmissoesAssinadas`)
   conta as assinadas esperando o contador e entra junto com a lista, no PR2.
8. **O telefone do pré-cadastro é opcional** (o cadastro exige o campo; ele nasce vazio e o
   colaborador informa o dele na primeira etapa, onde é obrigatório).
9. **O contrato assinado é congelado em texto** em `admissoes.contrato_texto` — é a prova do que
   foi assinado. O PDF dele e o zip dos documentos entram no PR3.

## 4. O corte em três PRs

| PR | O que entrega | Estado |
| --- | --- | --- |
| **PR1** | Banco (SQL aditivo + schema), regras puras, servidor completo, rotas do RH e do link, permissão, limites | pronto (#211) |
| **PR2** | As telas: lista `/admissoes`, painel na ficha do colaborador, o link mobile-first em etapas, as orientações finais, a configuração por empresa, o item no menu e no sino | pronto |
| **PR3** | Ficha de Admissão em PDF (formato do eSocial), zip dos documentos, PDF do contrato assinado nos anexos e o marco "enviado ao contador" com o download | a fazer |

Fora de escopo, como combinado: criar o acesso ao app do técnico na admissão (Fase 3), guardar o
ASO do exame e export específico do eSocial além do PDF.

## 5. Telas × botões (entregues no PR2)

Cada botão tem a permissão escondendo E o servidor recusando. Prints desktop e celular de todas
estas telas em `docs/prints/admissao-digital/`.

| Tela | Botão / ação | Rota | Permissão |
| --- | --- | --- | --- |
| Ficha do colaborador (`/colaboradores/[id]`) | **Gerar convite de admissão** (quando não há admissão viva) | `POST /api/admissoes` (com `colaboradorId`) | `admissao.gerenciar` |
| Ficha do colaborador | **Reenviar link**, **Invalidar link**, **Cancelar admissão** (com razão), **Ver progresso** | `POST …/[id]/reenviar`, `…/invalidar`, `…/cancelar`, `GET …/[id]` | `admissao.gerenciar` |
| Lista `/admissoes` (nova) | **Nova admissão** (pré-cadastro: nome + CPF + cargo + salário) | `POST /api/admissoes` | `admissao.gerenciar` |
| Lista `/admissoes` | busca + filtro por situação; por linha: reenviar, invalidar, cancelar, ver progresso | `GET /api/admissoes?busca=&situacao=` | `admissao.gerenciar` |
| Lista `/admissoes` | **Enviado ao contador**, **Admitir** (só depois de assinado) | `POST …/[id]/contador`, `POST …/[id]/admitir` | `admissao.gerenciar` |
| Lista `/admissoes` | **Baixar Ficha de Admissão (PDF)**, **Baixar documentos (zip)** | PR3 (a lista avisa que vem na próxima leva, sem botão morto) | `admissao.gerenciar` |
| Configurações › Admissão (nova) | **Salvar** modelo de contrato, orientações, documentos (obrigatório × opcional), validade do link, experiência | `GET`/`PUT /api/admissoes/config` | `admissao.gerenciar` |
| Link do colaborador `/admissao/[token]` | **Aceito o tratamento dos dados** (LGPD) | `POST /api/publico/admissao/[token]/consentimento` | token |
| Link do colaborador | **Salvar e continuar** (a cada etapa) | `PUT …/rascunho` | token |
| Link do colaborador | **Enviar código** / **Confirmar código** (e-mail) | `POST …/codigo`, `POST …/codigo/conferir` | token |
| Link do colaborador | **Enviar documento**, **Apagar documento** | `POST …/documentos`, `DELETE …/documentos/[id]` | token |
| Link do colaborador | **Concluir o preenchimento** | `POST …/concluir` | token |
| Link do colaborador | **Assinar o contrato** (nome + selfie) | `POST …/assinar` | token |
| Link do colaborador | tela final de orientações (sem botão: só o texto da empresa) | `GET /api/publico/admissao/[token]` | token |

## 6. LGPD e segurança

- **Token forte** (`randomBytes(32).base64url`, único no banco) e **link com validade** (1 a 60
  dias, padrão 7, configurável por empresa).
- **Consentimento registrado**: data/hora, IP e navegador. Sem ele o formulário não abre e nada é
  salvo.
- **O link devolve só o que é daquela pessoa**: empresa, o nome dela, o cargo, o próprio rascunho e
  os próprios documentos. Nunca o CPF inteiro do convite, nunca salário de outra pessoa, nunca o
  conteúdo dos arquivos na listagem — e o token não volta no corpo da resposta.
- **Acesso do RH restrito** a `admissao.gerenciar` (401 sem sessão, 403 sem a permissão) e sempre
  dentro da própria empresa (admissão de outra empresa é 404).
- **Documento conferido pelos bytes**: HTML/SVG com nome de imagem não entra.
- **Limite por IP** na rota pública (20 tokens recusados por hora) e limite próprio para os códigos
  de e-mail (15 por IP e 5 por admissão, por hora).
- **Dados sensíveis** (selfie, documentos) ficam no banco como os outros anexos do sistema, servidos
  só por rota autenticada.

## 7. Perguntas em aberto

1. **A lista `/admissoes` fica onde?** Ficou em **Equipe › Admissões** no menu (a sugestão do PR1),
   com a configuração em Configurações › Acesso e pessoas › Admissão digital. Se preferir outro
   lugar, é só dizer: mudar o item de grupo é uma linha.
2. **O preset de perfil que já ganha a permissão.** Hoje só o ADMINISTRADOR tem (por
   `permissoesTotais`); SUPERVISOR e FINANCEIRO ficaram de fora porque admissão mexe com dado
   sensível de pessoa. Se o RH da Frivo usa um perfil específico, digo qual preset recebe.
3. ~~**Quem é "o contador"?**~~ **Respondido no PR3:** sem e-mail automático. "Enviado ao contador"
   continua sendo o marco (quem e quando); quem manda é o RH, com a ficha e o pacote na mão. Se um
   dia o envio tiver de sair sozinho, aí entra o campo "e-mail do contador" na configuração.

## 8. O que o PR2 acrescentou (telas)

| Tela | Arquivo | Reaproveitou |
| --- | --- | --- |
| Lista `/admissoes` | `app/(dashboard)/admissoes/page.tsx` | `ListaUrl`/`TabelaProUrl`/`PaginacaoUrl`, `StatusPill`, `MenuAcoes`, `Dica`, tokens `PLANILHA` |
| Ações (lista e ficha) | `components/admissao/acoes-admissao.tsx` | `Modal`, `confirmar`/`toast`, `ItemMenu`, `FormField` |
| Nova admissão (pré-cadastro) | `components/admissao/nova-admissao.tsx` | `Modal`, `BuscaSelect`, `InputData`, `FormGrid` |
| Painel na ficha | `components/admissao/painel-admissao.tsx` + aba no `colaborador-form` | o mesmo desenho da aba "Acesso ao app" |
| Link do colaborador | `app/(publico)/admissao/[token]/page.tsx` + `components/admissao/admissao-publica.tsx` e `campos-admissao.tsx` | `Stepper`, `FormField`, `Select`, `InputData`, `lib/cep` |
| Configuração | `components/config/telas/admissao.tsx` + `admissao-config-client.tsx` | a gaveta de Configurações, `Textarea`, `Dica` |

Duas peças da casa nasceram aqui porque faltavam: **`BuscaSimplesUrl`** (busca ao vivo sem
typeahead, no kit de listas) e **`lib/cep.ts`** (a consulta ao ViaCEP que estava copiada em três
telas — cadastro rápido, unidades do cliente e unidades locais — agora numa função só; cada tela
mantém a própria regra de mesclagem).

## 9. O que o PR3 acrescentou (a entrega ao contador)

A última peça: o RH baixa a documentação pronta e manda ao escritório de contabilidade.

### A Ficha de Admissão em PDF

Segue os blocos do **eSocial — evento S-2200** ("Cadastramento Inicial do Vínculo e Admissão"):

1. **Identificação** — nome, nascimento, nome da mãe e do pai, sexo, estado civil, nacionalidade,
   naturalidade, escolaridade, telefone e e-mail
2. **Documentos** — CPF, RG, PIS/NIS, CTPS (número, série e UF), título de eleitor, reservista
3. **Endereço** — logradouro, número, complemento, bairro, cidade, estado e CEP
4. **Contrato de trabalho** — cargo, **CBO**, salário, data de admissão, jornada e o empregador
5. **Dependentes** — nome, parentesco, nascimento, CPF e os marcadores de **IRRF** e **salário-família**
6. **Dados bancários** — banco, agência, conta, tipo e chave PIX
7. **Assinatura do colaborador** — quem assinou, quando, de onde, e o consentimento da LGPD

Não é o XML do eSocial: é a ficha em papel que o escritório usa para lançar o evento, com os campos
na ordem em que ele os procura. Qualquer empresa que use o Frivo recebe a mesma ficha — o formato é
do eSocial, não da Termofrio.

**Nada inventa dado.** O que vale é o cadastro (é para lá que o preenchimento passou os dados); o
rascunho entra só como segunda fonte, para o campo que o cadastro não guarda. Campo que ninguém
preencheu sai como **—**, nunca em branco, e no fim da ficha há a lista do que ficou sem resposta:
o traço diz "foi perguntado e não veio", o vazio deixaria a dúvida de se o sistema esqueceu.

### O contrato assinado em PDF

O texto **congelado no momento da assinatura** (mudar o modelo depois não altera este), mais a prova
— nome digitado, data e hora, endereço de IP, navegador — e a **foto tirada na assinatura**. É o
arquivo que responde "o que foi assinado?" dois anos depois.

Na hora da assinatura ele é guardado **nos anexos do colaborador**, com categoria "Contrato de
trabalho" e origem "Enviado na admissão": aparece na seção Documentos da ficha junto com o resto dos
papéis da pessoa. Se a geração do PDF falhar, a assinatura **não cai** — ela já está gravada, e a
rota do contrato gera o arquivo na hora.

A seção Documentos já tinha, desde a leva anterior, uma linha "Contrato assinado" que abria o
**texto** congelado num diálogo. Com o PDF guardado, as duas apareceriam juntas dizendo a mesma
coisa. Agora o PDF manda: a linha do texto só aparece para quem assinou **antes** desta leva e por
isso não tem o arquivo. Um contrato, uma linha.

### O pacote (zip)

A ficha, o contrato e os documentos que o colaborador enviou, numa coisa só. Os arquivos enviados
vão numa pasta `Documentos enviados/`, com o **rótulo que a empresa pediu** ("RG (frente e verso)",
"Comprovante de residência") e a extensão vinda dos **bytes**, nunca do nome prometido.

O zip é montado pelo próprio sistema, com o `node:zlib` que já vem no Node — o projeto não tem
biblioteca de zip e não ganhou uma. Nome repetido vira "(2)" em vez de sobrescrever, e nome perigoso
(`../../etc/passwd`, barra no começo) nunca escreve fora da pasta onde o zip for aberto.

### Quando os downloads existem

De **ASSINADO** em diante (assinado, enviado ao contador, admitido). Antes disso a ficha sairia pela
metade, e meia ficha no contador é pior do que nenhuma. Marcar **"Enviado ao contador"** continua
sendo o registro de que o RH mandou — não é o que destrava o download, senão ele teria de marcar
como enviado *antes* de conseguir baixar o que vai enviar.

A regra mora em `lib/admissao/admissao-entrega-regras.ts`, lida pela tela **e** pelo servidor: o
botão nunca oferece o que a rota recusaria.

### Telas × botões

| Tela | Botões que ganhou |
| --- | --- |
| **Equipe › Admissões** (`/admissoes`), no ⋮ de cada linha | **Baixar a ficha (PDF)**, **Baixar os documentos (zip)**, **Baixar o contrato (PDF)** |
| **Ficha do colaborador › aba Admissão** | **Baixar a ficha (PDF)** e **Baixar os documentos (zip)** |
| **Ficha do colaborador › aba Documentos** | Nada novo — o contrato assinado passou a cair ali sozinho, como anexo de verdade |

O rodapé do PR2 que dizia "entram na próxima leva" saiu: a promessa foi cumprida, e texto que já não
é verdade é poluição.

### As rotas

| Rota | O que entrega | Permissão |
| --- | --- | --- |
| `GET /api/admissoes/[id]/ficha` | A Ficha de Admissão em PDF (`?ver=1` abre na aba) | admissao.gerenciar |
| `GET /api/admissoes/[id]/documentos` | O pacote (zip) | admissao.gerenciar |
| `GET /api/admissoes/[id]/contrato` | O contrato assinado em PDF | admissao.gerenciar |

Sem sessão 401, sem a permissão 403, admissão de outra empresa 404 — nunca o arquivo. Antes de
assinar, 409 dizendo o porquê.

### Reuso, não cópia

A maquinaria de desenho (folha A4, cabeçalho corrido, seção, parágrafo que quebra de página, tabela
com cabeçalho que se repete, rodapé numerado) **nasceu no documento do PMOC** e saiu para
`lib/pdf/desenho.ts` quando a ficha precisou da mesma coisa. O que amarrava ao PMOC era só o
cabeçalho e o rodapé: viraram um descritor. O documento do PMOC continua idêntico — os 24 testes
dele são a prova.
