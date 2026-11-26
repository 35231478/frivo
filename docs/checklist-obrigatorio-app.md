# Checklist de veículo obrigatório no app (o "porteiro")

Ideia do Zé: nos dias definidos, ao abrir o app, a **única tela** do colaborador é o checklist do veículo (tela cheia);
só acessa o resto do app depois de finalizar. É uma trava de **entrada no app**, diferente de uma trava por OS.

> 🔵 **Banco pendente**: `prisma/sql/2027-01-28_checklist_diario.sql` (aditivo, idempotente, sem retroativo).
> **Aplicar antes de subir o código.**

## Levantamento: o que foi reusado

| Peça | Reuso |
|---|---|
| Modelos de checklist de veículo (`checklist_templates`/itens) | O porteiro usa o modelo escolhido pela empresa |
| Checklist preenchido (`checklist_preenchidos`/itens: respostas, fotos, alerta por item, "Com alertas") | O checklist do porteiro é gravado aqui, como qualquer outro, com o colaborador e o veículo |
| Regras do checklist (`lib/veiculos/checklist`: alerta = fora da 1ª opção, obrigatório faltando) | As mesmas, no app e no servidor |
| Formulário de itens (`ItensChecklist`) | O mesmo bloco do painel; ganhou só a opção de reduzir a foto no aparelho |
| Veículo padrão do colaborador (`tecnicos.veiculo_id`) | É o veículo do porteiro |
| Sino do gestor (`/api/alertas` → `contarAlertasVeiculos`) | Já contava "Checklists com alertas" de hoje; ganhou "Não vão usar o veículo hoje" |
| Trava de entrada do app ("Exigir localização ativa") | O porteiro entra logo depois dela, no mesmo lugar |
| Offline do app (página guardada pelo navegador + banco do aparelho por usuário) | O formulário vem na página; a fila do porteiro fica no banco do aparelho, como a fila curta da localização |
| Permissão "Veículos › checklist" (já no perfil Técnico) | Quem faz o porteiro; o gestor vê com "Veículos › visualizar" e configura com "Configurações ou Frota › gerenciar" |

## Como funciona

- **Configuração** (Configurações › Checklists de veículo › "Checklist obrigatório no app"):
  - ligar ou desligar;
  - os dias da semana (padrão: segunda a sexta);
  - o modelo de checklist;
  - quem faz: **todos com veículo padrão** (o padrão) ou só os escolhidos.
- **Quem vê o porteiro**:
  - o colaborador com login no app, obrigado pela configuração;
  - com veículo padrão em uso (inativo ou em manutenção não conta);
  - com a permissão de checklist de veículo;
  - só com o módulo Frota ligado.
- **A tela**:
  - ocupa o app inteiro, sem a barra de navegação: "Checklist do veículo · dia", a placa e o modelo do veículo;
  - os itens do modelo e uma observação; o botão "Enviar checklist";
  - o link discreto "Hoje não vou usar o veículo", com motivo opcional.
- **Item com problema**: o checklist fica "Com alertas", o sino avisa o gestor e o técnico **segue liberado**. Tirar o veículo de uso é decisão do gestor.
- **Uma vez por dia**: feito (ou "não vou usar"), libera o dia (dia civil de Brasília) e renova no próximo dia de checklist.
- **Mudou de ideia**: depois do "não vou usar", o Meu dia mostra "Fazer checklist do veículo". O checklist troca o registro do dia e fica o rastro: situação anterior, motivo e a hora da troca.
- **Gestor**:
  - Veículos › Checklist › aba **Diário**: dia, colaborador, veículo, situação, hora e o checklist completo (respostas e fotos).
  - Situações: Feito, Com alertas, Não vai usar, **Sem registro** (dia de checklist que passou sem nada) e Ainda não fez (hoje).
  - Cada linha mostra também se foi "enviado sem sinal" e o rastro da troca.
  - O sino traz "Não vão usar o veículo hoje" até alguém abrir o histórico.

## Offline: nunca prende

1. **O formulário funciona sem sinal.** A página do app traz o resumo do porteiro (dias, veículo, modelo com os itens), e a cópia da página guardada pelo navegador abre sem sinal. O app decide sozinho se hoje é dia de checklist, pelo relógio do aparelho no fuso de Brasília.
2. **O registro vai para o aparelho e libera na hora.** "Enviar checklist" ou "Não vou usar" grava no banco do aparelho com um identificador próprio, e o app abre na mesma hora.
3. **O envio sobe sozinho.** Acontece ao abrir o app, quando a rede volta e a cada minuto com o app aberto. Reenviar não duplica, porque o servidor reconhece o identificador e a chave colaborador+dia.
4. **O servidor marca o atraso.** Guarda a hora do toque (relógio do aparelho) separada da hora da chegada, e marca **enviado sem sinal** quando o registro chegou depois.
5. **O servidor recusou (dado inválido, sem permissão):** o envio sai da fila, o aviso aparece no Perfil e o app **não trava de novo**.
6. **Sem banco no aparelho (aba anônima):** o registro fica na memória enquanto o app está aberto, e mesmo assim libera.

Por quê: travar o app sem sinal tiraria o técnico do trabalho na garagem ou na estrada. Liberar sem formulário perderia a inspeção. Ela pode ser feita sem sinal e só não pode sair do aparelho.

## Regras de segurança e dados

- **O alerta é decidido no servidor**, pelos itens do modelo, nunca pelo que o aparelho mandou.
- **Itens:** só os do modelo da empresa. Item que saiu do modelo é aceito, porque o técnico pode ter preenchido sem sinal antes da mudança.
- **Um registro por colaborador por dia.**
  - O "feito" nunca volta a "não vou usar".
  - Um segundo "feito" (de outro aparelho) não cria outro checklist.
  - Dois envios ao mesmo tempo resultam num checklist só, por causa de uma trava por colaborador+dia.
- **Dia aceito:** até hoje (pelo servidor) e até 30 dias para trás, para cobrir registros que ficaram no aparelho.
- **Multiempresa:** veículo, modelo e colaborador da empresa da sessão; a configuração é por empresa.
- **Frota desligada:** o porteiro não existe. Um envio que já estava no aparelho é aceito sem gravar, para a fila esvaziar; nunca há 403 para o app.

## Banco (🔵)

**`configuracoes`** (tudo desligado por padrão):

| Coluna | Tipo e padrão |
|---|---|
| `checklist_diario_ativo` | boolean, `false` |
| `checklist_diario_dias` | int[], `{1,2,3,4,5}` (segunda a sexta) |
| `checklist_diario_template_id` | text, ligado ao modelo de checklist; vira vazio se o modelo for apagado |
| `checklist_diario_todos` | boolean, `true` |
| `checklist_diario_tecnicos` | text[], vazio |

**Tipo `SituacaoChecklistDiario`:** `FEITO` ou `NAO_VAI_USAR`.

**Tabela `checklist_diario`:**

| Coluna | Para quê |
|---|---|
| `empresa_id`, `tecnico_id`, `usuario_id` | de quem é e quem tocou |
| `dia` (date) | o dia civil de Brasília |
| `veiculo_id` | o veículo inspecionado |
| `situacao` | feito ou não vai usar |
| `checklist_id` | aponta para o checklist preenchido |
| `motivo` | texto opcional do "não vou usar" |
| `feito_em`, `recebido_em` | hora do toque e hora da chegada |
| `enviado_offline` | chegou depois, sem sinal |
| `client_id` | o identificador do aparelho; único |
| `visto_em` | o gestor viu o "não vou usar" |
| `situacao_anterior`, `trocado_em` | o rastro da troca |

Chaves únicas: `client_id`, `checklist_id` e colaborador+dia. Índice por empresa e dia.

## Testes

- **Regras puras** (`checklist-diario.test.ts`): dias e fuso, quem é obrigado, quando o porteiro abre, a decisão de cada envio, "sem sinal", dia aceito, o histórico com "Sem registro".
- **PostgreSQL real** (`checklist-diario-pg.test.ts`):
  - o SQL rodado 3 vezes (idêntico ao Prisma);
  - o resumo do porteiro;
  - o envio: grava o checklist como os outros, alerta decidido no servidor, reenvio, corrida, troca com rastro, "sem sinal", dia futuro, item de fora, permissão, multiempresa, Frota desligada;
  - o histórico e o sino;
  - a configuração.
- **App** (`checklist-diario-app.test.ts`), com o app de verdade e o banco do aparelho:
  - a tela única, o obrigatório faltando, o envio que libera;
  - **sem sinal**: libera, reabre sem travar e sobe quando o sinal volta, uma vez só;
  - "não vou usar" e o atalho que troca;
  - a recusa que aparece no Perfil;
  - quando não há porteiro e a virada do dia;
  - a fila do aparelho.
