# OS em campanha — múltiplas visitas

Uma manutenção grande não cabe num dia: a limpeza química de 300 aparelhos de um cliente corre o mês
inteiro. **Planejar visitas** divide os equipamentos da OS em visitas diárias, em um clique, sem criar
outra OS.

Vale para OS de **manutenção** com vários equipamentos — a que o cronograma do PMOC gera ou qualquer
outra. Instalação é assunto do futuro módulo de Projetos.

## Como as visitas se ligam à OS

**Cada visita é uma atividade da própria OS**, com o seu lote de equipamentos:

| O quê | Onde fica |
|---|---|
| A visita | Uma linha de `atividades_os`, marcada com `plano_visitas_id` |
| O lote da visita | `atividade_equipamentos` (como em qualquer atividade) |
| O plano da OS | `os_planos_visitas`: quantidade por dia e se pula o fim de semana. Um por OS |

Por ser atividade, a visita já aparece **no calendário da empresa no dia certo** e **na agenda do
técnico no app**, entra no relatório e conta para a conclusão automática da OS — sem agenda paralela.

Continua sendo **uma OS só**: um serviço, uma competência do PMOC, uma cobrança.

## Planejar

Botão **Planejar visitas** na aba Atividades da OS, quando há uma atividade agendada, ainda não
iniciada, com 2 equipamentos ou mais. O diálogo pede:

| Campo | Observação |
|---|---|
| Data de início | Proposta: a data da atividade (nunca no passado nem no fim de semana) |
| Equipamentos por dia | Proposta: 25 (ou o total, se for menor) |
| Pular sábado e domingo | Ligado por padrão. É a regra de dia útil dos contratos e do PMOC |
| Quem executa | Opcional: equipe ou colaboradores, com veículo. Em branco, as visitas nascem "sem quem execute" |

A **prévia** mostra quantas visitas serão, de que dia a que dia e o lote de cada dia, antes de
confirmar.

O que acontece ao confirmar:

- os equipamentos são ordenados por local (setor, ambiente, TAG) e fatiados em lotes: vizinhos caem
  no mesmo dia;
- a atividade que já existia vira a **1ª visita**; as outras são criadas copiando dela o serviço, a
  duração, a orientação, a hora e quem executa;
- a previsão de conclusão da OS passa para o dia da última visita (nunca encurta);
- fica registrado no histórico da OS.

Quem executa passa pelas mesmas validações de uma atividade comum: colaborador ativo e com competência
no serviço, equipe ativa, veículo da empresa.

## O que o planejamento pode mexer

Só a visita **pendente**: agendada e sem nenhum registro de execução.

Deixa de ser pendente — e passa a ser intocável — a visita que:

- está em andamento, concluída ou cancelada;
- tem equipamento marcado como atendido;
- tem checklist, formulário, foto, relatório, serviço adicional, aviso "A caminho/Cheguei" ou
  observação do técnico.

Atividade da OS que não é visita (uma vistoria avulsa, por exemplo) nunca entra no planejamento.

## Replanejar e ajustar

| Ação | O que faz |
|---|---|
| **Replanejar** | Refaz as visitas pendentes com nova data, quantidade ou fim de semana. Reaproveita as que existem, cria as que faltam, tira as que sobram |
| **Incluir dia** | Mais uma visita no dia escolhido; os equipamentos pendentes são repartidos por igual |
| **Tirar o dia** | A visita deixa de existir; os equipamentos dela vão para as outras pendentes |
| **Mover de dia** | Só aquela visita muda de dia |
| **Mover equipamentos** | Ajuste manual: leva equipamentos marcados de uma visita pendente para outra |

Garantias:

- **idempotente**: replanejar com os mesmos parâmetros não muda nada (as mesmas atividades, nos mesmos
  dias, com os mesmos lotes);
- **nenhum equipamento em duas visitas pendentes**, e nenhum se perde;
- **não apaga o que foi feito**: visita iniciada ou concluída fica idêntica;
- dois planejamentos ao mesmo tempo não criam visita em dobro (trava por OS).

**Sobras.** Equipamento que ficou sem atendimento numa visita concluída aparece no painel. Ao
replanejar, pode voltar numa visita nova (marcado por padrão). A visita concluída não é mexida: o
equipamento continua lá como não atendido, e o progresso o conta uma vez só.

## Progresso e conclusão

- **Progresso somado**: equipamento distinto atendido sobre equipamento distinto nas visitas
  ("180 de 300 equipamentos"). Visita cancelada não conta.
- Aparece no painel "Visitas" (com a barra) e no cabeçalho da OS.
- A OS **conclui quando todas as visitas concluem** — é a regra de status automático que já existia.
  Enquanto houver visita aberta, fica "Em andamento".

## Onde aparece

| Lugar | O que mostra |
|---|---|
| OS › Atividades | O painel "Visitas" e, em cada atividade, "Visita 3 de 12" |
| Calendário | Um card por dia de visita; no detalhe, "Visita 3 de 12" |
| App do técnico | A visita no dia dela, com o lote e "Visita 3 de 12" |
| PMOC › Cronograma | A OS continua uma só, ligada à competência |

## PMOC

A OS gerada pelo cronograma do PMOC pode ser dividida em visitas. Depois disso, **"Reagendar
atividades" do cronograma não mexe nela**: quem manda nas datas e nos lotes é o planejamento de
visitas. O cronograma continua enxergando a OS inteira (todos os equipamentos, somando as visitas).

## Permissões

| Ação | Permissão |
|---|---|
| Ver as visitas e o progresso | `ordens.visualizar` |
| Planejar, replanejar e ajustar | `ordens.editar` |
| Técnico do app | 403: o planejamento é do escritório |

O técnico executa a visita do dia no app, como qualquer atividade.

## Banco

`prisma/sql/2026-12-20_os_plano_visitas.sql` — aditivo e idempotente, sem enum:

- tabela `os_planos_visitas`;
- coluna `atividades_os.plano_visitas_id` (vazia em todas as atividades que já existem).

## Onde está

- Regras: `lib/os/visitas.ts`. Servidor: `lib/os/visitas-server.ts`.
- Rota: `/api/ordens/[id]/visitas` (GET = estado; POST = planejar e ajustar).
- Tela: `components/os/os-visitas.tsx`.
