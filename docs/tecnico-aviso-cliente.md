# App do técnico — avisar o cliente: "A caminho" e "Cheguei"

> **Onde o técnico toca mudou** (ver `docs/tecnico-meu-dia-cheguei.md`): os botões saíram de dentro da
> OS e foram para o **card do Meu dia**. "Cheguei" é o botão principal e abre a OS; "A caminho" é
> opcional. Dentro da OS fica só o registro. As regras abaixo (horário, e-mail, um por dia, janela
> de 5 minutos, banco) continuam as mesmas.

No card da OS (Meu dia e Agenda), dois toques: **A caminho** e **Cheguei**. O toque:

1. **registra o horário** na atividade e no **Histórico da OS** (o escritório vê quem tocou e quando);
2. **avisa o cliente por e-mail**, com uma mensagem curta e o nome da empresa — se houver sinal na hora;
3. vira o registro: o botão passa a mostrar **"avisado às HH:MM"** e não avisa de novo.

Mensagens (sem saudação, sem emoji):

- `{Empresa}: nosso técnico está a caminho do seu atendimento.`
- `{Empresa}: nosso técnico chegou ao local.`

## 🔵 Banco — dois itens, aditivos

**O SQL foi gerado e NÃO foi aplicado:** `prisma/sql/2026-12-06_app_avisar_cliente.sql`.

| Item | O que é |
|---|---|
| `configuracoes.app_avisar_cliente` (coluna nova, `BOOLEAN NOT NULL DEFAULT true`) | A permissão "Avisar o cliente (a caminho / cheguei)". As empresas já cadastradas começam **ligadas**. |
| `atividade_avisos` (tabela nova) | O horário de cada toque e o que aconteceu com o aviso. A chave única (atividade, evento, dia) é o que impede o segundo aviso. |

- Aditivo e idempotente (pode rodar mais de uma vez); nada existente é removido nem alterado.
- **Rodar ANTES do merge** — o app passa a ler a coluna e a tabela assim que o código entra:
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-06_app_avisar_cliente.sql`
- O teste `sql-app-avisar-cliente` roda o arquivo num PostgreSQL de verdade e compara a tabela com a
  que o Prisma cria a partir do `schema.prisma`: colunas, tipos, padrões, índices e chaves idênticos.

Por que uma tabela, e não colunas na atividade: a chave única por dia resolve a idempotência no próprio
banco (dois aparelhos tocando juntos = um aviso), e guarda o desfecho do aviso (enviado, para quem, ou
por que não saiu) sem engordar `atividades_os`. A linha do tempo continua sendo o `os_historico`.

## Levantamento: o que foi reaproveitado × o que foi criado

| Peça | Situação | Como entrou |
|---|---|---|
| **Envio de e-mail pelo Resend** (`enviarEmail`, `lib/email.ts`) | Reaproveitado | Mesma configuração da empresa (chave criptografada, remetente), mesmo layout, mesmo registro em `email_logs`. |
| **Modelos de e-mail editáveis** (`TEMPLATES_PADRAO`, Configurações › E-mail › Modelos) | Reaproveitado + 2 modelos novos | "Técnico a caminho" e "Técnico no local". A empresa pode editar o texto ou desativar o modelo, como os outros. |
| **Quem recebe** (`getEmailsComunicacao` de **Ordens**, `montarDestinatarios`, cópias do cliente) | Reaproveitado | A mesma resolução dos e-mails de OS: contatos da aba Comunicação › Ordens → contato operacional → e-mail do cadastro. Se a OS foi aberta por um contato, ele recebe primeiro. |
| **"Cliente não recebe e-mails de OS"** (`emailReceberOs`, cadastro do cliente) | Reaproveitado | Respeitado: horário registrado, sem aviso. |
| **Linha do tempo da OS** (`OsHistorico`, cartão Histórico da OS) | Reaproveitada | "Técnico a caminho" / "Técnico chegou ao local", com o horário **do toque** e o desfecho do aviso. Nenhuma tela nova no escritório. |
| **Fila offline do app** (`lib/tecnico/sync.ts`, motor, banco do aparelho) | Reaproveitada | O toque é mais uma operação (`avisoCliente`): mesma ordem por atividade, mesma idempotência por operação, mesmo reenvio. |
| **Contexto da execução** (`carregarContexto`) | Reaproveitado | Mesma conferência de permissão, empresa, atividade aberta e escopo do técnico (só as atividades dele). |
| **Permissões do app** (`ConfigApp`, Equipes › App do colaborador) | Reaproveitadas + 1 permissão nova | `avisarCliente` segue o mesmo caminho das outras 12. |
| **Recado do servidor ao técnico** (`aoAvisar` do motor) | Reaproveitado | "Cliente avisado: técnico a caminho." sai pelo mesmo canal do aviso de série repetida. |
| **WhatsApp do cliente** (`whatsappContatoPrincipal`, contatos de Comunicação) | Reaproveitado | Para achar o número do toque manual. |
| **Integração de WhatsApp por API** | **Não existe** | Ver abaixo. |
| Regras do aviso (`lib/tecnico/aviso-cliente.ts`) | **Criado** | Mensagens, janela de tempo, horário do toque, texto do botão. Puro, serve ao servidor e ao aparelho. |
| Registro e envio (`lib/execucao/aviso-cliente.ts`) | **Criado** | Grava o toque, decide, envia, escreve o histórico. |
| Os dois botões (`components/tecnico/aviso-cliente.tsx`) | **Criado** | Na OS do app. |
| Tabela `atividade_avisos` e coluna `app_avisar_cliente` | **Criado** | 🔵 acima. |
| Relógio do aparelho no envio da fila (`agora` no corpo do sync) | **Criado** | Para medir há quanto tempo o toque foi feito mesmo com o relógio do aparelho errado. Opcional: app antigo continua funcionando. |

## WhatsApp: o que existe e o que foi feito

**O sistema não tem integração de envio por WhatsApp.** O que existe hoje:

- links `wa.me` montados na tela (relatório, orçamento, cobrança, pedido de compra);
- dois toggles em Configurações ("Notificar cliente por WhatsApp ao abrir/concluir OS") que **são
  salvos mas não disparam nada** — nenhum código lê esses campos para enviar;
- o canal "WhatsApp" na aba Comunicação do cliente, que hoje só serve de preferência.

Por isso, **nada foi inventado**: depois do toque, aparece **"Avisar pelo WhatsApp"**, que abre o
WhatsApp do técnico na conversa do cliente com a mensagem pronta. O técnico só aperta enviar.

- Número usado: contato que abriu o chamado → contato de Ordens que aceita WhatsApp → contato
  principal → celular do cadastro.
- Só aparece com **"Exibir contatos do cliente" ligado** e se o cliente tiver número. Com a permissão
  desligada, o número **nem sai do servidor**.
- Abrir o WhatsApp não é registrado (o sistema não tem como saber se a mensagem foi enviada).

## Sem sinal: horário sim, aviso velho não

O toque **sempre** registra o horário, na hora, no aparelho. O aviso ao cliente depende de quando o
toque chega ao servidor:

| Situação | Horário | Aviso ao cliente |
|---|---|---|
| Com sinal | Registrado | **Enviado** |
| Sem sinal; o sinal volta em **até 5 min** | Registrado (o do toque) | **Enviado** — ainda faz sentido |
| Sem sinal; a fila sobe **depois de 5 min** | Registrado (o do toque) | **Não enviado.** O histórico da OS diz "tocado sem sinal; chegou ao sistema N min depois" |

- **Decisão minha, confira:** a janela é de **5 minutos** para os dois eventos (`JANELA_AVISO_MS`).
  É uma constante: mudar é uma linha.
- O atraso é medido com **o relógio do próprio aparelho** (hora do toque × hora do envio). Aparelho
  com relógio errado não faz o aviso sair atrasado nem deixar de sair — e o horário gravado é corrigido
  para o relógio do servidor.
- A tela mostra o estado: "12:00 · aviso a enviar" enquanto está em tempo; "12:00 · sem aviso (sem
  sinal)" quando a janela passou. Sem sinal, a linha de ajuda avisa da regra antes do toque.

## Idempotência

- **Um aviso de cada evento por atividade, por dia.** Tocar de novo, reenviar a mesma gravação ou dois
  aparelhos tocando juntos: um e-mail, um registro (chave única no banco).
- Depois do toque o botão fica desabilitado, mostrando "avisado às HH:MM".
- **Decisão minha, confira:** é **por dia** (Brasília), não uma vez na vida da atividade — a atividade
  que continua no dia seguinte (ou foi remarcada) pode avisar de novo.
- "Cheguei" sem ter tocado "A caminho": "A caminho" sai da tela. Se chegar ao servidor depois da
  chegada, fica registrado sem aviso.

## Outras decisões (confira)

- **Avisar não começa o atendimento.** A atividade continua "Agendada"; quem inicia é a primeira
  gravação da execução, como antes.
- **Os botões ficam enquanto a atividade está aberta** (agendada ou em andamento), no topo da OS. Em
  atividade concluída ou cancelada não aparecem, e o servidor recusa.
- **Quando o e-mail não sai, a gravação não falha.** O horário fica, e o histórico diz o motivo:
  cliente sem e-mail, cliente que não recebe e-mails de OS, e-mail da empresa não configurado, modelo
  desativado ou falha do Resend.
- **Permissão desligada com toque antigo na fila:** o horário é registrado, nada é enviado (não trava a
  fila do técnico).

## Permissão — Equipes › App do colaborador

**"Avisar o cliente (a caminho / cheguei)"**, por empresa, **ligada por padrão**. Desligada: os botões
não aparecem, o retrato da atividade não leva nada do aviso e o servidor não envia.

## Privacidade (permissões do app)

- O **e-mail do cliente nunca vai para o aparelho**: nem no retrato, nem no resultado da gravação, nem
  no texto do botão ou do recado. Só o escritório vê o destinatário (no histórico da OS).
- O **WhatsApp** só vai com "Exibir contatos do cliente" ligado.
- Com "Exibir dados do cliente" desligado, os botões funcionam e o bloco não mostra nada do cliente.
- A mensagem e o destinatário **não vêm do aparelho**: a operação só diz o evento.

## Arquivos

- Regras: `lib/tecnico/aviso-cliente.ts` · servidor: `lib/execucao/aviso-cliente.ts`
- Fila: `lib/tecnico/sync.ts`, `app/api/tecnico/sync/route.ts`, `lib/tecnico/offline/{motor,estado,tipos}.ts`
- Retrato: `app/api/tecnico/atividades/[atividadeId]/route.ts`
- Tela: `components/tecnico/aviso-cliente.tsx`, `components/tecnico/execucao.tsx`, `components/tecnico/contexto.tsx`
- Permissão: `lib/tecnico/config-app.ts`, `app/api/configuracoes/route.ts`, `components/equipes/app-colaborador-client.tsx`
- E-mail: `lib/email-templates.ts` (2 modelos), `lib/email.ts` (`montarDestinatarios` exportado)
- Banco: `prisma/schema.prisma`, `prisma/sql/2026-12-06_app_avisar_cliente.sql`

## Testes

- `aviso-cliente` (26): mensagens, link do WhatsApp, horário do toque e relógio errado, janela, texto
  do botão, um por dia, operação da fila, estado no aparelho, permissão.
- `aviso-cliente-pg` (28, PostgreSQL real, só o Resend simulado): e-mail e destinatários, histórico,
  idempotência (toque repetido, reenvio, três envios simultâneos), fila que sobe tarde, relógio errado,
  sem destino, e-mail fora do ar, modelo editado/inativo, permissão, privacidade, escopo do técnico.
- `aviso-cliente-ui` (21, tela real com o banco do aparelho): botões, toque duplo, sem sinal (2 min e
  40 min), reabrir o app, WhatsApp, permissões.
- `sql-app-avisar-cliente` (7): o SQL de produção num PostgreSQL de verdade, comparado com o Prisma.
- `config-app`: expectativa atualizada de 12 para 13 permissões (mudança intencional).

## Prints

Em `docs/prints/tecnico-aviso-cliente/` (desktop e celular): os botões, "a caminho" avisado com o
toque de WhatsApp, "cheguei", sem sinal, sinal que voltou 40 min depois, dados do cliente ocultos,
permissão desligada, a permissão em Equipes, o histórico no escritório e o e-mail que o cliente recebe.

Nos prints o e-mail "sai" para um receptor local no lugar do Resend (nenhum e-mail real foi enviado).
