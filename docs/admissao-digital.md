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
| **PR1** (este) | Banco (SQL aditivo + schema), regras puras, servidor completo, rotas do RH e do link, permissão, limites | pronto |
| **PR2** | As telas: painel na ficha do colaborador, lista `/admissoes`, o link mobile-first em etapas, a tela de orientações finais, a configuração por empresa e o item no sino | a fazer |
| **PR3** | Ficha de Admissão em PDF (formato do eSocial), zip dos documentos, PDF do contrato assinado nos anexos e o marco "enviado ao contador" com o download | a fazer |

Fora de escopo, como combinado: criar o acesso ao app do técnico na admissão (Fase 3), guardar o
ASO do exame e export específico do eSocial além do PDF.

## 5. Telas × botões (o que o PR2 tem de pendurar)

Nenhum botão foi para tela alguma neste PR — ele é só banco, regras e servidor. A tabela abaixo é o
contrato do PR2: cada rota já existe e está testada, e cada botão tem a permissão escondendo E o
servidor recusando.

| Tela | Botão / ação | Rota | Permissão |
| --- | --- | --- | --- |
| Ficha do colaborador (`/colaboradores/[id]`) | **Gerar convite de admissão** (quando não há admissão viva) | `POST /api/admissoes` (com `colaboradorId`) | `admissao.gerenciar` |
| Ficha do colaborador | **Reenviar link**, **Invalidar link**, **Cancelar admissão** (com razão), **Ver progresso** | `POST …/[id]/reenviar`, `…/invalidar`, `…/cancelar`, `GET …/[id]` | `admissao.gerenciar` |
| Lista `/admissoes` (nova) | **Nova admissão** (pré-cadastro: nome + CPF + cargo + salário) | `POST /api/admissoes` | `admissao.gerenciar` |
| Lista `/admissoes` | busca + filtro por situação; por linha: reenviar, invalidar, cancelar, ver progresso | `GET /api/admissoes?busca=&situacao=` | `admissao.gerenciar` |
| Lista `/admissoes` | **Enviado ao contador**, **Admitir** (só depois de assinado) | `POST …/[id]/contador`, `POST …/[id]/admitir` | `admissao.gerenciar` |
| Lista `/admissoes` | **Baixar Ficha de Admissão (PDF)**, **Baixar documentos (zip)** | PR3 | `admissao.gerenciar` |
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

## 7. Perguntas em aberto (para o Zé decidir no PR2)

1. **A lista `/admissoes` fica onde?** O módulo está na seção **Equipe** das permissões; o item do
   menu pode ficar em Equipe (ao lado de Colaboradores) ou dentro de Configurações › Equipe.
   Sugestão: Equipe › Admissões.
2. **O preset de perfil que já ganha a permissão.** Hoje só o ADMINISTRADOR tem (por
   `permissoesTotais`); SUPERVISOR e FINANCEIRO ficaram de fora porque admissão mexe com dado
   sensível de pessoa. Se o RH da Frivo usa um perfil específico, digo qual preset recebe.
3. **Quem é "o contador"?** Hoje "Enviado ao contador" é um marco (quem e quando) com o download
   pelo RH. Se o contador tiver de receber por e-mail automático, isso é um campo de configuração a
   mais (e-mail do contador) no PR3.
