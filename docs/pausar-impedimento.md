# Pausar / impedimento na atividade (app do técnico)

Leva "App pronto pra janeiro 2", PR A. Decisão D1: aprovada pelo Zé, para antes de janeiro.

## O que o técnico faz

1. **Pausar.** Na OS em andamento, o botão **"Pausar atividade (impedimento ou intervalo)"**:
   - motivo **obrigatório**, da lista da empresa;
   - observação **opcional** ("Outro" pede o texto);
   - foto **opcional**.
2. **Motivos padrão** (a empresa edita, inativa e cria outros):

   | Motivo | Tipo | Observação |
   |---|---|---|
   | Falta de peça/material | Impedimento | |
   | Cliente ausente | Impedimento | |
   | Acesso negado | Impedimento | |
   | Aguardando aprovação do cliente | Impedimento | |
   | Chuva/condição do local | Impedimento | |
   | Almoço/intervalo | Intervalo | |
   | Outro | Impedimento | o técnico escreve o motivo |

3. **Pausada.** No topo da OS **e** do equipamento aparece a faixa **"Pausada — Falta de peça/material — há 2 h 5 min"**, com:
   - **Retomar:** volta para a execução;
   - só no impedimento, **"Encerrar a visita: não concluída (precisa voltar)"**, com confirmação.

   Enquanto pausada:
   - o "Concluir atividade" some (concluir sem retomar fecha a pausa na hora da conclusão);
   - o aviso de "esquecida" não aparece.
4. **Meu dia:** o cartão mostra **"Pausada — motivo"**, também sem sinal (a fila do aparelho corrige o que veio do servidor).
5. **Sem sinal:** pausar, retomar e encerrar gravam na fila e valem já na tela. Cada pausa tem um id gerado no aparelho:
   reenviar não cria outra pausa e nada se repete (**idempotente**).

## Não concluída — precisa voltar

Só com uma pausa **de impedimento** aberta. Ao encerrar:
- a pausa fecha, marcada como "não concluída";
- os equipamentos **não feitos** recebem o motivo no **"não atendido"** de sempre, o mesmo do relatório. É um jeito só;
  os feitos não mudam;
- a atividade volta a **Agendada, sem data**: o escritório reagenda;
- o histórico da OS registra "Visita não concluída — reagendar", com o motivo;
- o técnico vê "Visita encerrada como não concluída (motivo). O escritório vai reagendar."

## Tempo de execução

- Cada pausa guarda o **início e o fim**, no relógio do aparelho.
- O tempo pausado **não conta** como execução: `tempoDeExecucaoMs`, em `lib/pausas/regras`. Pausas sobrepostas contam uma
  vez só; a aberta vai até agora.
- Na OS, o escritório vê "Execução 1 h 15 min · pausas 45 min".

## O que o escritório vê

- **Na OS:** o selo da atividade vira **"Pausada — motivo — há X h"** (vermelho no impedimento, amarelo no intervalo).
- **Na lista de OS:** o mesmo selo, ao lado do status.
- **Nas Pendências e no sino:**
  - **"Atividades pausadas por impedimento"**: o almoço não entra;
  - **"Visitas não concluídas (reagendar)"**.
- **Push "Atividade pausada por impedimento":**
  - um por pausa, só para o escritório;
  - o almoço não avisa;
  - cada pessoa liga ou desliga em Perfil › Notificações.
- **Relatório da OS:** a seção **"Pausas (só o escritório vê)"** aparece **só na versão interna**. O relatório do cliente
  (link, PDF, WhatsApp) **nunca** mostra pausas.
- **Configurações › Ordens de serviço › Motivos de pausa:**
  - criar, editar e inativar, com tipo, "o técnico escreve o motivo" e ordem;
  - os padrões nascem na primeira lista;
  - inativar tira o motivo do app, e as pausas já feitas não mudam.

## Banco (🔵 SQL aditivo, o usuário aplica)

`prisma/sql/2027-02-21_atividade_pausas.sql` cria um tipo e duas tabelas:
- `TipoMotivoPausa` (IMPEDIMENTO, INTERVALO);
- `motivos_pausa`;
- `atividade_pausas`, com `client_id` único.

Idempotente (roda 3× sem erro) e só aditivo: nada existente muda. O estado "pausada" é derivado da pausa aberta, então
**não há valor novo** no status da atividade e nada do que lê o status quebra.

## Arquivos

- **Regras e servidor:** `lib/pausas/regras.ts` (regras puras) e `lib/pausas/servidor.ts`:
  - motivos;
  - pausar, retomar e não concluída;
  - pausas abertas;
  - contagem do sino.
- **App:**
  - sync: operações `pausar`, `retomar` e `naoConcluida` (`lib/tecnico/sync.ts`);
  - a tela antes de sincronizar: `lib/tecnico/offline/estado.ts`;
  - componentes: `components/tecnico/pausa.tsx`.
- **Escritório:**
  - `components/os/os-atividades.tsx`;
  - `lib/os/lista-server.ts` e `components/ordens/ordens-lista-client.tsx`;
  - `lib/alertas/*`;
  - `lib/cadastros/registro.ts` ("motivos-pausa");
  - `components/relatorio/relatorio-os-documento.tsx`.

## Testes

- **`janeiro2-pausas-pg` (8, PostgreSQL real, rotas de verdade):**
  - motivos padrão;
  - pausar idempotente;
  - uma pausa aberta por vez;
  - o cadastro vale sobre o aparelho;
  - "Outro" pede o texto;
  - motivo inativado ou apagado;
  - retomar e o tempo;
  - não concluída;
  - concluir fecha a pausa;
  - o sino e a atividade esquecida;
  - o relatório.
- **`janeiro2-pausas-regras` (12):**
  - tempo (sobreposição, bordas, aberta);
  - os textos;
  - a pausa do cartão com a fila do aparelho;
  - a tela antes de sincronizar;
  - o schema do sync;
  - o push.
- **`janeiro2-pausas-ui` (9, componentes de verdade):** o botão, o modal, a faixa, retomar, encerrar com confirmação e
  onde a pausa aparece.
- **`sql-atividade-pausas` (3):** o SQL 3×, idêntico ao Prisma, aditivo.
- **Mutação:** 34 mutantes, 33 mortos. O 1 que sobrou é equivalente: uma pausa de 0 min soma 0 de qualquer jeito.
