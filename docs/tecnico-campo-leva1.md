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
  `app-campo-leva1-pg` (25, PostgreSQL real com as rotas de verdade), `sql-app-materiais-campo` (5).
- O teste no PostgreSQL achou um bug antes do PR: na rota da ficha, o filtro de escopo do técnico (`OR`) era
  sobrescrito pelo `OR` da janela de hoje — atividade de outro técnico podia levar à OS dele. Corrigido com `AND`.

## Prints

`docs/prints/tecnico-campo-leva1/` — `antes-*` e `depois-*`, iPhone 13, Pixel 7 e desktop (Chromium com a tela e o
agente de cada aparelho; o WebKit não está instalado neste ambiente). Empresa de demonstração, dados fictícios.
