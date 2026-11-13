# App do técnico — "O que levar" e "Como chegar"

Dois ganhos para antes de sair: saber o que carregar no veículo e abrir o mapa até o cliente.

## O que levar (materiais previstos)

**É previsão.** Não baixa estoque, não reserva, não altera a OS. O consumo real continua sendo
registrado na execução e no estoque.

### De onde vem

Só do que o sistema já grava — nada é digitado nem inventado:

| Fonte | Tabela | Regra |
|---|---|---|
| Materiais **lançados** na linha de serviço da OS | `os_materiais` | Valem na quantidade lançada. É o retrato copiado da composição ao lançar o serviço, já com o que o escritório ajustou |
| **Composição padrão** do serviço | `servico_materiais` (+ `kit_material_itens`) | Só quando a linha de serviço do catálogo **não tem** material lançado. Kit é aberto nos seus itens |
| **Peças** vendidas na OS | `os_itens_orcamento` (tipo `PRODUTO`) | Entram na quantidade da linha |

Não entra:

- material marcado **"não usado"** (quantidade 0);
- material que o estoque já deu como **consumido** ou **devolvido** (já foi levado);
- linha já marcada como **executada**;
- a linha de produto que só **espelha** uma peça do serviço (já contada no material);
- serviço **sem composição** e linha livre: não aparece material para eles.

A regra está em `lib/tecnico/o-que-levar.ts` (pura) e a leitura em `lib/tecnico/o-que-levar-server.ts`
(uma consulta para a lista inteira; nenhum valor de venda ou custo é selecionado).

### Onde aparece

- **Meu dia** — bloco "O que levar hoje", fechado, com o resumo ("5 materiais para 3 OS"). Um toque
  abre a soma do dia: descrição, quantidade e unidade.
- **Agenda** — um bloco por dia ("O que levar neste dia"), para carregar na véspera.
- **Card da OS** — uma marca ("2 materiais") e, ao abrir o card, a lista daquela OS.
- **Dentro da OS** — "O que levar · N materiais", recolhido.

### Como soma

- Por **produto + unidade** (linha livre: pela descrição, sem diferença de acento ou maiúscula).
- No dia, **cada OS conta uma vez**: duas atividades da mesma OS não dobram o material.
- Atividade **concluída** ou **cancelada** sai da conta — inclusive a que o técnico concluiu no
  aparelho e ainda não enviou.

### Opção por empresa

*Equipes › App do colaborador › Mostrar "O que levar" (materiais previstos)*. Nasce **ligada**.
Desligada, os materiais nem saem do servidor, e o app esconde o que já estava guardado no aparelho.
Coluna `configuracoes.app_o_que_levar` (SQL: `prisma/sql/2027-01-02_app_o_que_levar.sql`).

### Sem sinal

Os materiais vêm dentro do cartão da OS, que o app já guarda no aparelho (lista do dia, agenda e o
retrato de cada OS). O bloco funciona sem sinal com o que foi baixado por último.

### Limites conhecidos

- O material é **da OS**, não da visita. Numa OS dividida em várias visitas, a mesma lista aparece em
  cada dia até a linha ser marcada como executada ou o estoque registrar o consumo.
- OS **sem linha de serviço** (por exemplo, preventiva gerada só com o tipo de OS) não tem material
  previsto.
- A quantidade da composição é a **do cadastro do serviço**, igual ao que o sistema copia ao lançar o
  serviço na OS — não é multiplicada pela quantidade da linha.

### Anotado para depois (decisão do Zé, 13/11/2026 — não entra agora)

- **Kit de preventiva por tipo de equipamento** (split, VRF, chiller…). Preventiva é metade do
  trabalho e hoje a OS de contrato/PMOC, por não ter linha de serviço, não mostra "o que levar". O
  caminho é um cadastro novo: um kit por tipo de equipamento, que alimenta o "o que levar"
  automaticamente a partir dos equipamentos da OS. Até lá, nada é forçado para essas OS.
- **Mostrar o que o estoque já separou.** `os_materiais` já guarda o estado da separação; a marca
  "já separado" na lista fica para quando o fluxo de separação estiver mais usado.

## Como chegar (rota)

O botão já existia como "Rota no mapa". Agora:

- chama-se **"Como chegar"**;
- abre **Google Maps**, **Waze** ou, no iPhone/iPad/Mac, **Mapas da Apple** — sempre por URL universal
  de mapas (`lib/tecnico/cartao.ts`): sem chave de API e sem custo. Na primeira vez o app pergunta;
  depois abre direto (a escolha fica no aparelho; troca-se em Perfil › Meus dados);
- o destino são as **coordenadas da unidade**, quando há; senão o endereço da unidade; senão o do
  cliente;
- **sem endereço no cadastro**, o botão fica no lugar, apagado, com "Sem endereço no cadastro" — em
  vez de sumir;
- depois de "Avisar que estou a caminho", o botão continua ao lado do "Cheguei".

Confirmado pelo Zé (13/11/2026): o nome fica **"Como chegar"**; e o Mapas da Apple **não** é oferecido
no Android (lá ele abriria uma página, não o app — pareceria defeito). Android: Google Maps e Waze.
iPhone, iPad e Mac: os três.

Privacidade: com *Exibir dados do cliente* desligado, endereço e rota não saem do servidor e o botão
não aparece (nem o aviso de falta de endereço — não é falta de cadastro).

## Testes

- `tests/unit/tecnico-o-que-levar.test.ts` — regras puras (materiais, soma, dia, links de mapa).
- `tests/unit/tecnico-o-que-levar-pg.test.ts` — rotas reais com PostgreSQL real.
- `tests/unit/tecnico-o-que-levar-ui.test.ts` — telas num DOM de verdade, com o banco do aparelho.
- `tests/unit/sql-app-o-que-levar.test.ts` — o SQL de produção, comparado com `prisma db push`.

Prints em `docs/prints/tecnico-o-que-levar/`.
