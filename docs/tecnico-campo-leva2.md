# App do técnico — leva app-campo 2

## PR A: garantia visível e comentários na OS

### Garantia no app

O dado já existia no cadastro do equipamento (`garantia_ate`), e o escritório já via. O app passa a mostrar um
selo, com a **mesma regra** do escritório (`lib/equipamento-garantia`: vencendo em até 30 dias; o dia do fim conta
inteiro, em Brasília):

| Situação | Selo |
|---|---|
| Vigente | "Em garantia até 24/03/2028" (verde) |
| Vence em até 30 dias | "Garantia vence em 12/12/2026" (âmbar) |
| Vencida | "Garantia vencida em 10/01/2025" (cinza) |
| Sem garantia cadastrada | nada |

Onde: na **lista de equipamentos da OS**, na **tela do equipamento** e na **ficha** aberta pelo QR. Sem SQL.

### Comentários na OS (técnico ↔ escritório)

- **Conversa interna**: o cliente nunca vê. Relatório, PDF e link do aceite não leem os comentários (travado em
  teste).
- **App**: seção "Comentários" logo depois do topo da OS. O técnico escreve com ou sem sinal; o `client_id` faz o
  comentário reenviado não duplicar. O técnico vê os comentários das OS em que tem atividade, e pode comentar também
  com a atividade concluída.
- **Novos no app**: as respostas do escritório chegam na próxima sincronização. O card do **Meu dia** mostra
  "1 comentário novo" e, na OS, as novas ficam destacadas ("2 novos"). Abrir a OS marca como visto neste aparelho.
- **Escritório**: card "Comentários" na aba **Resumo** da OS. Abrir marca como lido para quem abriu; responder pede
  **OS › Editar**. O **sino** mostra "Comentários novos do campo" (OS com comentário do app que a pessoa ainda não
  leu, últimos 30 dias), com link para a OS.
- O modo técnico não usa as rotas do escritório (403). Nada se edita nem se apaga.

### 🔵 Banco (PR A) — duas tabelas novas, aditivas

**SQL gerado e NÃO aplicado:** `prisma/sql/2027-02-03_app_comentarios_os.sql`.

- `os_comentarios` (a conversa) e `os_comentarios_lidos` (até quando cada pessoa do escritório leu, por OS).
- Aditivo e idempotente. **Rodar ANTES do merge**:
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-03_app_comentarios_os.sql`

### Mudanças fora do app do técnico (mínimas)

| Arquivo | Por quê |
|---|---|
| `lib/execucao/dados.ts` | `garantiaAte` no select e na apresentação do equipamento (o escritório ganha o campo, sem mudar nada na tela) |
| `components/os/os-detalhe.tsx` + `components/os/comentarios-os.tsx` | O card de comentários na aba Resumo |
| `lib/alertas/sino.ts`, `app/api/alertas/route.ts`, `components/layout/header.tsx` | O grupo "Comentários novos do campo" |
| `prisma/schema.prisma` | Os dois modelos e as relações de volta |

### Achado nos prints

No print do Android, o comentário novo do escritório não aparecia destacado: o app gravava o "visto" antes de
terminar de ler o anterior (corrida entre duas gravações no banco do aparelho). Corrigido: o "visto" só avança
depois da leitura.

### Testes (PR A)

- `app-campo-leva2` (10, regra pura), `app-campo-leva2-ui` (7, tela), `app-campo-leva2-pg` (10, PostgreSQL real),
  `sql-app-comentarios-os` (5).
- **Mutação: 29 de 29 mortos.** Na 1ª rodada sobraram 2:
  - "o sino conta resposta do escritório": faltava a prova de que uma OS só com respostas do escritório não acende o
    sino de quem nunca leu. Ganhou teste;
  - "garantia sem situação": era equivalente, mas mostrou que uma data que não se lê viraria "Garantia vence em —".
    O selo agora só sai com data válida, e isso tem teste.

- **Suíte completa: 538 arquivos, 8.070 testes, todos verdes.** Typecheck limpo e build de produção ok. Na 1ª rodada
  caíram 24 testes de outras telas da OS: o card de comentários quebrava quando a resposta não trazia a lista (os testes
  da OS simulam o `fetch`), e um teste de padronização fixa a linha do Resumo da OS. Corrigido: o card aguenta resposta
  vazia ou erro de rede, e a linha do Resumo ficou como era (o card entra numa linha própria).

### Prints (PR A)

`docs/prints/tecnico-campo-leva2/`: `antes-*` (app e escritório) e `depois-20…26` (iPhone 13, Pixel 7, desktop),
`depois-30` (sino) e `depois-31` (card do escritório, desktop e celular). Dados fictícios.

## PR B: despesas de campo com foto do cupom

Não existia módulo de despesas nem de reembolso. O mínimo que entrou, com as decisões do Zé:

### No app (técnico)

- **Onde lança:** "Lançar despesa" no **Meu dia** (despesa sem OS: pedágio, combustível do dia) e "Lançar despesa desta OS"
  na tela da OS (a despesa fica ligada à OS). "Minhas despesas" fica no **Perfil**.
- **O que pede:** categoria (lista fixa: Combustível, Pedágio, Estacionamento, Alimentação, Hospedagem, Material
  comprado em campo, Outros), valor, dia, **como foi paga** ("Do meu bolso" ou "Cartão ou dinheiro da empresa"),
  descrição (obrigatória só em Outros) e a **foto do cupom** (obrigatória). O botão "Lançar" só acende completo.
- **Sem sinal:** grava no aparelho e sobe sozinha. Reenviar não duplica (`client_id`).
- **Minhas despesas:** só as do próprio colaborador, dos últimos 90 dias: "No aparelho", "Aguardando aprovação",
  "Aprovada", "Recusada" (com o motivo) e "Reembolsada" (a conta de reembolso foi paga). O envio recusado pelo servidor
  aparece como "Não enviada", com o motivo.
- **O técnico nunca vê custo da OS:** a lista dele não traz OS alheias, conta a pagar nem valores de outros.
- **Permissão:** "Lançar despesas pelo app" em **Equipes › App do colaborador**, **ligada** por padrão. Desligada, o
  botão some e o servidor recusa.
- **Regras do servidor:** dia não pode ser no futuro nem ter mais de 60 dias; valor maior que zero, até R$ 100.000, no
  máximo 2 casas; foto de verdade (JPG, PNG, WEBP ou HEIC, até 5 MB); só nas OS em que o técnico tem atividade (também
  com a atividade concluída). Usuário sem colaborador ligado não lança (aviso na tela).

### No escritório

- **Financeiro › Pagamentos › Despesas de campo** (link novo no menu). Filtros: A aprovar (padrão), Aprovadas,
  Recusadas, Todas. No topo: quantas esperam decisão, o total e quanto disso é reembolso.
- **Cupom:** abre a foto em tela cheia, com "Baixar".
- **Aprovar** (quem lança contas a pagar: Financeiro › Fluxo de caixa):
  - **do bolso do colaborador:** pede o vencimento (sugere daqui a 7 dias) e a categoria financeira; gera **uma** conta
    a pagar de reembolso com o colaborador como favorecido. Dois cliques ou duas pessoas ao mesmo tempo não geram duas;
  - **pela empresa:** só registra (fica como custo da OS), sem conta a pagar.
- **Recusar:** motivo obrigatório. O colaborador lê o motivo no app.
- **Categorias:** cada categoria fixa ligada a uma categoria financeira. Padrão: a de mesmo nome (sem diferença de
  maiúsculas ou acentos); se não existir, é criada na primeira aprovação. A empresa troca em "Categorias".
- **Na OS:** aba **Financeiro**, card "Despesas de campo" com o **custo aprovado** (soma só as aprovadas), para quem vê
  o Financeiro. Some quando a OS não tem despesa.
- **Sino:** "Despesas de campo a aprovar", para quem lança contas a pagar.

### 🔵 Banco (PR B) — duas colunas e duas tabelas novas, aditivas

**SQL gerado e NÃO aplicado:** `prisma/sql/2027-02-04_app_despesas_campo.sql`.

- `configuracoes.app_lancar_despesas` (padrão **ligado**) e `configuracoes.despesas_campo_categorias` (o mapa);
- `despesas_campo` (a despesa, a decisão e a conta de reembolso) e `despesas_campo_fotos` (a foto, à parte: a lista
  nunca arrasta a imagem).
- Aditivo e idempotente. **Rodar ANTES do merge** (depois do SQL do PR A):
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-04_app_despesas_campo.sql`

### Mudanças fora do app do técnico (PR B)

| Arquivo | Por quê |
|---|---|
| `app/(dashboard)/financeiro/despesas-campo/`, `components/financeiro/despesas-campo-view.tsx`, `app/api/despesas-campo/` | A tela e as rotas do escritório |
| `components/os/despesas-campo-os.tsx`, `components/os/os-detalhe.tsx`, `app/api/ordens/[id]/despesas-campo` | O card na aba Financeiro da OS |
| `components/layout/sidebar.tsx`, `components/layout/header.tsx` | O link no menu, o nome no caminho do topo e o item do sino |
| `lib/alertas/sino.ts`, `app/api/alertas/route.ts` | A contagem do sino |
| `app/api/configuracoes/route.ts`, `components/equipes/app-colaborador-client.tsx` | A permissão "Lançar despesas pelo app" |
| `prisma/schema.prisma` | Os dois modelos, as duas colunas e as relações de volta |

### Achados nos prints (PR B)

- O "← Perfil" grudava no título "Minhas despesas" (mesma linha, sem espaço). Corrigido.
- O caminho do topo do escritório mostrava "Despesas-cam…". Ganhou o nome "Despesas de campo".

### Testes (PR B)

- `app-campo-leva2-despesas` (18, regra pura), `app-campo-leva2-despesas-ui` (11, tela), `app-campo-leva2-despesas-pg`
  (16, PostgreSQL real), `sql-app-despesas-campo` (6, o SQL rodado 2× e comparado com o Prisma).
- **3 testes antigos atualizados de propósito:** as listas travadas da configuração do app (a coluna nova) e as seções do
  Perfil ("Minhas despesas").
- **Mutação: 65 mutantes, 63 mortos, 2 equivalentes.** Na 1ª rodada sobraram 6:
  - **achado de segurança:** "sino no modo técnico" mostrou que as rotas do escritório não barravam o modo técnico. Um
    técnico com o Financeiro liberado veria as despesas dos colegas e o custo da OS. Agora as 7 rotas recusam (403), com
    teste e 8 mutantes novos (todos mortos);
  - "aprovar a já decidida" e "descrição só de espaços" ganharam prova; "decide sem permissão" ganhou uma pendente no
    teste de quem só vê;
  - **equivalentes:** aparar o motivo da recusa e a descrição de "Outros" no servidor (o schema já apara antes).
- A suíte completa pegou a tela geral de Configurações: ela manda a configuração inteira de volta e o servidor recusava
  o campo do mapa de categorias. Agora o campo é ignorado ali (tem rota própria) e há teste de que salvar Configurações
  não apaga o mapa.
- **Fora do app (1 linha):** `lib/importacao/lotes-regras.ts` ganhou o nome "despesas de campo" para a relação nova do
  colaborador (o teste da implantação exige nome para toda relação).

### Prints (PR B)

`depois-40…44` (iPhone 13, Pixel 7, desktop): botão no Meu dia, lançamento preenchido, lançamento sem sinal
("No aparelho"), sincronizado, e a lista depois da decisão do escritório. `depois-50…59` (escritório): sino, lista a
aprovar, cupom, aprovar com reembolso, recusar, aprovar paga pela empresa, decididas (desktop e celular), categorias,
card na OS e a conta de reembolso em Contas a pagar. O cupom é uma imagem fictícia ("DOCUMENTO FICTÍCIO").
