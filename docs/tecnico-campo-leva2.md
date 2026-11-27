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

- `app-campo-leva2` (10, regra pura), `app-campo-leva2-ui` (7, tela), `app-campo-leva2-pg` (9, PostgreSQL real),
  `sql-app-comentarios-os` (5).

### Prints (PR A)

`docs/prints/tecnico-campo-leva2/`: `antes-*` (app e escritório) e `depois-20…26` (iPhone 13, Pixel 7, desktop),
`depois-30` (sino) e `depois-31` (card do escritório, desktop e celular). Dados fictícios.
