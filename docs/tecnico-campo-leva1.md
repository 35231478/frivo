# App do técnico — leva app-campo 1 (PR 1): QR do equipamento e materiais usados

Comparação de partida: o app de campo do concorrente tem 4 portas para materiais e nenhuma leitura de QR que leve
ao equipamento certo. Aqui: **um botão** no Meu dia que leva ao equipamento, e **um lugar só** para o material usado.

## 1. Ler QR do equipamento (Meu dia)

Botão grande **"Ler QR do equipamento"** no Meu dia (o mesmo leitor do cadastro de equipamento: câmera, foto do QR
ou código digitado; lê sem sinal). O app decide no **aparelho**, com as OS do dia que já estão guardadas:

| O equipamento lido | O que acontece | Grava algo? |
|---|---|---|
| Está numa atividade de hoje | Abre o equipamento **dentro da OS** (em andamento vence agendada) | Não |
| Está numa atividade de hoje ainda sem "Cheguei" | Mostra o card; o **"Cheguei" abre direto no equipamento** | Só o "Cheguei" |
| É da unidade de uma atividade aberta, mas não está nela | Abre a OS e **pergunta**: "Incluir nesta atividade?" | Só se confirmar |
| Não está em nenhuma OS de hoje | Abre a **ficha** do equipamento com o histórico | Não |
| …e está sem sinal | Avisa "Sem sinal: a ficha deste equipamento abre quando houver internet." e fica no Meu dia | Não |

- **"Incluir e abrir"** grava o vínculo pela fila (sem sinal também) e deixa no **Histórico da OS**:
  "Equipamento incluído pelo técnico (QR Code)", com o equipamento e a atividade. Uma vez só, mesmo reenviado.
- **A ficha** (`GET /api/tecnico/equipamentos/qr?valor=`): só leitura. Exige **Equipamentos › Visualizar** e o módulo
  **QR Codes**; QR inativo, de outra empresa ou desconhecido = "QR Code não reconhecido.". Respeita
  **"Exibir dados do cliente"** (sem ele, cliente e unidade nem saem do servidor). **Nunca leva valores**: sem decisão
  de cobrança de adicional, sem link do relatório (tem token), sem endereço de foto (só a contagem). Agendamento
  futuro (ex.: cronograma do PMOC) não é histórico e não aparece. Até 20 atendimentos (o completo fica no escritório).
- Se o servidor encontrar o equipamento numa atividade **dele** hoje que o aparelho não conhecia (ex.: vinculado de
  outra unidade do cliente), a ficha leva direto para a OS.

## 2. Materiais usados (um lugar só)

Seção **"Materiais usados"** dentro de cada equipamento e na OS (lá, com o nome do equipamento de cada linha).
"Adicionar material" → busca no catálogo → quantidade (botões **−** e **+** grandes, aceita vírgula) → equipamento
(padrão: o que está aberto; ou "Geral da atividade") → **Lançar**. "Não está no catálogo" descreve o material.

- **Catálogo no aparelho** (`GET /api/tecnico/catalogo`): só código, nome e unidade dos produtos ativos. **Nunca**
  preço, custo, margem ou saldo. Baixa junto com as OS do dia (abrir o Meu dia com sinal), então funciona sem sinal.
- **Offline e idempotente**: cada linha tem `clientId` gerado no aparelho; a mesma gravação reenviada (ou repetida)
  não duplica nem baixa de novo (chave única empresa + client_id no banco).
- **Corrigir e remover**: o técnico toca na linha **dele** e corrige a quantidade ou remove, enquanto a atividade
  está aberta. Linha de outra pessoa da equipe: só leitura, com o nome de quem lançou.

### Baixa do estoque (decisões do Zé)

| Situação | Lançamento no razão (`movimentacoes_estoque`) |
|---|---|
| Produto do catálogo que controla estoque | **SAIDA** de origem OS, `ref_id` = OS, `local_id` = veículo |
| Veículo | O da atividade; sem ele, o veículo padrão do técnico (ou do responsável) |
| Material **separado** para a OS (mesmo produto, ainda separado ou consumido pelo próprio campo) | Vira o **consumo** daquela separação: a parte reservada troca RESERVA → SAIDA (líquido zero) e só o excedente baixa a mais. **Nunca baixa duas vezes** |
| Sem saldo | Lança assim mesmo (estoque negativo) e o escritório vê no sino **"Saldo negativo por uso em campo"** |
| Corrigir / remover / estornar | Só a **diferença** (ESTORNO_SAIDA / RESERVA de volta). O razão nunca é apagado |
| Fora do catálogo, produto que não controla estoque, módulo Estoque desligado | Só o registro, sem razão |

- Consumo da separação informado pelo campo: no Estoque › separação, o "desfazer consumo" do escritório é recusado com
  "Consumo informado pelo técnico em campo: corrija ou estorne em Materiais usados em campo." (desfazer por fora
  deixaria o lançamento do técnico sem baixa).
- Separação com a sobra já **devolvida**: o uso em campo daquele material não muda mais ("A sobra deste material já
  voltou ao estoque: fale com o escritório.").

### Escritório: OS › Materiais & Compras › "Materiais usados em campo"

Lista o que os técnicos lançaram (atividade, equipamento, veículo, se veio da separação), com **quem lançou, quem
corrigiu e quem estornou, e quando**. Com **OS › Editar**: **Corrigir** (quantidade) e **Estornar**. Cada correção e
estorno vai também para o **Histórico da OS**. Estornados ficam riscados, como registro. Não muda depois que a OS
entrou numa medição válida. O técnico (modo técnico) não usa essas rotas, mesmo com OS › Editar.

## 🔵 Banco — uma tabela nova, aditiva

**SQL gerado e NÃO aplicado:** `prisma/sql/2027-02-01_app_materiais_campo.sql`.

- `atividade_materiais` (tabela nova). Nada existente é removido nem alterado; a coluna `movimentacoes_estoque.local_id`
  já existia ("futuro: estoque por local") e passa a ser preenchida com o veículo.
- Aditivo e idempotente (`CREATE TABLE/INDEX IF NOT EXISTS`, chaves em `DO $$`). **Rodar ANTES do merge**:
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-01_app_materiais_campo.sql`
- O teste `sql-app-materiais-campo` roda o arquivo duas vezes num PostgreSQL real e compara com o que o Prisma cria.

## Mudanças fora do app do técnico (mínimas)

| Arquivo | Por quê |
|---|---|
| `lib/estoque/servidor.ts` | `movimentar` aceita `localId` (grava o veículo no razão). Opcional: quem não passa, nada muda |
| `lib/estoque/consumo-server.ts` | Recusa "desfazer consumo" de separação consumida pelo campo |
| `lib/alertas/sino.ts`, `app/api/alertas/route.ts`, `components/layout/header.tsx` | Um grupo novo no sino (saldo negativo por uso em campo), só para quem vê o Estoque e nunca no modo técnico |
| `components/os/os-detalhe.tsx` + `components/os/materiais-campo.tsx` | O card do escritório na aba Materiais & Compras |
| `lib/execucao/acoes.ts` | `vincularEquipamentos` registra no histórico quando a origem é o QR do Meu dia |
| `prisma/schema.prisma` | Modelo `AtividadeMaterial` e as relações de volta (sem mudança de coluna existente) |

## Arquivos

- Regras puras: `lib/tecnico/qr-campo.ts`, `lib/tecnico/materiais.ts`
- Servidor: `lib/execucao/materiais-campo.ts`, `app/api/tecnico/equipamentos/qr`, `app/api/tecnico/catalogo`,
  `app/api/ordens/[id]/materiais-campo` (+ `[linhaId]`), `lib/tecnico/sync.ts` (operações `material`, `materialRemover`)
- Aparelho: `lib/tecnico/offline/{estado,tipos,motor}.ts`
- Telas: `components/tecnico/qr-equipamento.tsx`, `components/tecnico/materiais.tsx`, `meu-dia.tsx`, `execucao.tsx`,
  `equipamento.tsx`, `contexto.tsx`, `app-tecnico.tsx`

## Testes

- `app-campo-leva1` (30, regra pura), `app-campo-leva1-ui` (21, DOM real + banco do aparelho real),
  `app-campo-leva1-pg` (27, PostgreSQL real com as rotas de verdade), `sql-app-materiais-campo` (5).
- **Mutação: 62 de 62 mortos.** Na 1ª rodada sobraram 2, que eram buracos de prova e ganharam teste: a OS já numa
  medição não muda mais o material usado, e saldo exatamente zero não é "negativo" no sino.
- Suíte inteira: 525 arquivos, 7.899 testes, todos verdes (com o PostgreSQL). Typecheck limpo. Build de produção ok.
- O teste no PostgreSQL achou um bug antes do PR: na rota da ficha, o filtro de escopo do técnico (`OR`) era
  sobrescrito pelo `OR` da janela de hoje — atividade de outro técnico podia levar à OS dele. Corrigido com `AND`.

## Prints

`docs/prints/tecnico-campo-leva1/` — `antes-*` e `depois-*`, iPhone 13, Pixel 7 e desktop (Chromium com a tela e o
agente de cada aparelho; o WebKit não está instalado neste ambiente). Empresa de demonstração, dados fictícios.

---

# PR 2: atividade esquecida em andamento e topo da OS

## 3. Atividade esquecida em andamento

| Quem | Quando | Onde |
|---|---|---|
| Técnico | Passou de **X horas** em andamento (por empresa, **padrão 4 h**) | Faixa no **Meu dia** (um toque abre a OS) e no topo da **OS** |
| Técnico | O **expediente do dia acabou** (jornada de Configurações › Horário comercial; sem ela, seg a sex até 18h) | Idem |
| Técnico | A atividade **começou em outro dia** | Idem |
| Gestor | Em andamento há mais de X horas, ou desde outro dia | **Sino**: "Atividades esquecidas em andamento" (link para a OS da mais antiga) |

- O aviso ao técnico é calculado **no aparelho**: funciona sem sinal (o "iniciar" ainda na fila já conta pela hora do toque).
- **X horas**: Equipes › App do colaborador › "Atividade esquecida em andamento" (1 a 24 h). Fora disso, a tela
  trava o salvar e o servidor recusa (400).
- **Início gravado** (`atividades_os.iniciada_em`): a 1ª gravação no app, pela **hora do toque** (corrigida pelo
  relógio do servidor, como o "Cheguei"). Reabrir pelo escritório recomeça. Atividades antigas, sem a coluna, usam
  a hora agendada (o SQL não reescreve nada).
- Push (app fechado) fica para a leva própria (chave VAPID), como combinado.

### Concluir com tempo suspeito

Tempo suspeito = passou do limite desde o início, ou virou o dia. No "Concluir atividade" aparece **"Horário de
término"** com três opções, a primeira já marcada:

1. **última gravação** (resposta, foto, equipamento, serviço extra, foto do serviço ou material — do servidor ou do
   aparelho, a mais recente) — confirmar é 1 toque;
2. **agora**;
3. **outro horário** (no dia em que começou, se foi em outro dia), validado: precisa ficar entre o início e agora.

- O servidor confere de novo (`terminoEm` na operação `concluir`): fora do intervalo = 422 "O horário de término
  precisa ficar entre o início da atividade e agora." e a atividade continua aberta.
- Vale como **data da conclusão** (relatório e Desempenho) e fica no **Histórico da OS**: "Horário de término
  informado — Término informado pelo técnico: 16:20 (concluída no app às 18:05)".
- Sem tempo suspeito, nada muda: tudo feito = **Concluir → Concluir atividade** (2 toques).

## 4. Topo da OS: o que fazer

Ordem nova do topo: número e tipo · status → cliente → prazo e prioridade alta → **Problema relatado** (chamado do
cliente) ou **O que fazer** → equipamentos ("3 equipamentos · 1 atendido") → endereço → **Como chegar · Ligar ·
WhatsApp** (botões grandes, 1 toque cada) → **Detalhes** (recolhido).

- **Detalhes**: atividade, horário e duração, unidade, prioridade, origem (aberta pelo escritório, recorrente,
  chamado do cliente), **aberta por**, visita N de M, orientação do escritório e os materiais previstos.
- **WhatsApp**: o mesmo número do aviso ao cliente (contato que abriu o chamado → contato de Ordens → principal →
  celular), só com "Exibir contatos do cliente"; desligado, o número nem sai do servidor.
- Explicações que estavam na tela (câmera rápida, fotos do serviço) foram para a dica (ⓘ).

## 🔵 Banco (PR 2) — duas colunas, aditivas

**SQL gerado e NÃO aplicado:** `prisma/sql/2027-02-02_app_atividade_esquecida.sql`.

- `atividades_os.iniciada_em` (`TIMESTAMP(3)`, opcional) e `configuracoes.app_alerta_andamento_horas`
  (`INTEGER NOT NULL DEFAULT 4`). Nada é reescrito.
- **Rodar ANTES do merge**:
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-02_app_atividade_esquecida.sql`

## Mudanças fora do app do técnico (PR 2, mínimas)

| Arquivo | Por quê |
|---|---|
| `lib/alertas/sino.ts`, `app/api/alertas/route.ts`, `components/layout/header.tsx` | Grupo "Atividades esquecidas em andamento" (quem vê OS, nunca o técnico) |
| `app/api/ordens/[id]/atividades/[atividadeId]/route.ts` | Reabrir (voltar a Em andamento) recomeça o início |
| `app/api/configuracoes/route.ts`, `components/equipes/app-colaborador-client.tsx`, `lib/tecnico/config-app.ts` | O limite de horas (Equipes › App do colaborador) |
| `lib/execucao/acoes.ts` | `iniciarAtividade` grava o início; `concluirAtividade` aceita o término informado |
| `lib/execucao/aviso-cliente.ts` | `whatsappDoCliente` (mesma resolução do aviso, para o botão do topo) |
| `prisma/schema.prisma` | As duas colunas |

## Testes (PR 2)

- `app-campo-leva1-pr2` (19, regra pura), `app-campo-leva1-pr2-ui` (17, tela), `app-campo-leva1-pr2-pg` (9,
  PostgreSQL real), `sql-app-atividade-esquecida` (5).
- **Mutação: 41 de 41 mortos.** Os 2 sobreviventes da 1ª rodada ganharam prova: atividade que começou ontem à noite e
  ainda está abaixo do limite (o sino conta, porque virou o dia) e retrato antigo no aparelho com contatos (a tela
  esconde ligar/WhatsApp quando a empresa desligou "Exibir contatos do cliente").
- Suíte inteira (PR 1 + PR 2): 529 arquivos, 7.950 testes, todos verdes (com o PostgreSQL). Typecheck limpo. Build
  de produção ok.

## Prints (PR 2)

`depois-20…24` (iPhone 13, Pixel 7, desktop): faixa no Meu dia, topo da OS com a faixa, botões de 1 toque,
"Detalhes" aberto, concluir com término sugerido e "outro horário" fora do intervalo. `depois-25` e `depois-26`:
o campo de horas em Equipes › App do colaborador e o sino do gestor. ANTES do topo: `antes-02/03-*`.
