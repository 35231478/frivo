# Acabamento dos temas 4, 5 e 6

**Sem mudança de banco.** Nenhum item precisou de coluna, índice ou migração: tudo o que foi usado
já estava gravado (a foto do app já guarda a atividade em que foi tirada; o vínculo já guarda o
equipamento).

**Um item ficou PARADO** — "levar o aviso de série para o app do técnico" — porque o app do técnico
hoje não cadastra equipamento. Detalhe e pergunta na seção do tema 5.

## Relatório da OS (tema 4)

### 1. As fotos da execução tiradas no app entram no relatório
- **Antes:** antes/depois e a foto do problema (item em "Atenção") já saíam, dentro do bloco de cada
  equipamento. As **"Fotos do serviço"** (as que o técnico tira no app com legenda, fora do
  checklist) **não saíam**.
- **Agora:** entram.
  - Foto de um **equipamento atendido** → dentro do bloco dele, depois das do checklist, com a legenda
    que o técnico escreveu (mesmo que tenha sido tirada em outra atividade da mesma OS).
  - Foto **"Geral da OS"** (fachada, quadro elétrico…) e foto de equipamento que **não chegou a ser
    atendido** → nova seção **"Fotos do serviço"** (a do equipamento leva o nome dele na legenda).
- Vale para o relatório da OS (versão do cliente e interna, tela e impressão/PDF), o relatório da
  atividade e o link antigo do relatório.
- Foto de atividade **cancelada** não entra (a mesma regra dos equipamentos e dos adicionais).
- A seção de configuração "Fotos dos equipamentos" passou a se chamar **"Fotos da execução"**: é ela
  que liga/desliga também as fotos do serviço. Nenhuma configuração salva muda.
- Foto enviada pelo **escritório** continua fora do relatório (fica na galeria da OS).

### 2. O card "Fotos" conta só as fotos da execução
- **Antes:** contava tudo da galeria, inclusive o que o escritório enviou.
- **Agora:** conta o que o técnico tirou na visita — checklist (antes/depois/item), fotos do serviço
  do app, formulário e serviço adicional. As do escritório continuam na galeria, fora da conta.

### 3. O cabeçalho da OS conta equipamento distinto
- **Antes:** somava os vínculos — o mesmo equipamento atendido em duas atividades aparecia como 2.
- **Agora:** usa **a mesma regra** do card "Equipamentos atendidos" e do relatório (uma função só,
  `lib/os/equipamentos-atendidos.ts`): equipamento distinto, atividade cancelada não conta, e OS
  antiga concluída sem vínculo conta o equipamento principal.

### 4. Remover uma foto específica do PDF
- **Nada foi removido.** Fica aguardando você apontar qual.

## Equipamento (tema 5)

### 1. Série repetida dentro da mesma leva do cadastro por foto
- A leva é a sequência de "Cadastrar outro" (o cliente e o endereço ficam; só as fotos mudam).
- **Agora:** se a etiqueta lida repete uma que acabou de ser cadastrada na leva, o aviso aparece
  **logo depois da leitura** (antes de responder o resto) e de novo na revisão:
  "Este nº de série já foi cadastrado nesta leva. Confira se não fotografou a mesma etiqueta duas vezes."
- É conferido **no aparelho**: aparece na hora, mesmo com sinal ruim.
- **Só aviso:** o Salvar continua liberado. Quando o servidor também acha o equipamento, ele aparece
  uma vez só (sem aviso em dobro).

### 2. Aviso de série no app do técnico — PARADO, precisa de decisão
- O app do técnico (`/tecnico`) **não tem cadastro de equipamento**: nele o técnico vincula à
  atividade os equipamentos que já existem na unidade (pelo QR ou pela lista). E quem usa o app não
  abre o cadastro do painel — é levado de volta para o "Meu dia".
- Onde o cadastro em campo existe hoje — **Cadastro pela foto**, no painel, pelo celular — o aviso de
  série já aparece, e agora também o da mesma leva.
- Levar o aviso para o app significa, antes, **levar o cadastro de equipamento para o app**: tela
  nova, fila sem sinal e decisão de quem pode. Isso é decisão de produto, então não fiz.
- **Pergunta:** quer que o app do técnico passe a cadastrar equipamento em campo? Se sim, o aviso vai
  junto. Detalhe a decidir: sem sinal não dá para consultar as séries da empresa — o aviso só
  apareceria com sinal (ou na sincronização).

## Datas e horas (tema 6)

### Hora inválida ou vazia bloqueia o salvar
- **Antes:**
  - Calendário › Nova OS: hora vazia ou inválida agendava às **08:00** em silêncio.
  - Campos de data e hora (Nova OS, atividades da OS, gerar OS do orçamento): apagar a hora gravava
    **08:00**; uma hora inválida deixava valendo, calada, **a hora anterior**.
- **Agora**, nas cinco telas: com data escolhida, o horário é exigido.
  - O campo fica em vermelho com "Informe um horário válido (hh:mm).".
  - Ao salvar: **"Informe um horário válido (hh:mm) para salvar."** — e nada é gravado.
  - Corrigiu, a mensagem some e salva no horário digitado.
- O que **não** mudou:
  - Ao escolher a data, a hora 08:00 entra **à vista** no campo (a pessoa vê e troca se quiser).
  - Campo de agendamento opcional continua opcional: sem data, não há hora a exigir.
  - A jornada do colaborador continua opcional (não é agendamento de OS).

## Testes
- `acabamento-relatorio-os` (12): fotos do serviço no relatório (regra, documento, configuração) e
  o cabeçalho distinto, igual ao card e ao relatório.
- `os-fotos-anexos-pg` (Postgres real, +2): fotos do app no relatório, card "Fotos" sem as do
  escritório, atividade cancelada.
- `acabamento-serie-leva-ui` (6): o cadastro por foto de ponta a ponta, duas vezes na mesma leva.
- `acabamento-hora-ui` (16): o campo, o calendário, a atividade da OS, gerar OS e a trava de todos os usos.
- Expectativas antigas atualizadas **de propósito** (a regra mudou):
  - `fuso-ui`: apagar a hora não grava mais 08:00;
  - `os-fotos-anexos-pg`: o card "Fotos" não conta mais as do escritório;
  - `leva-relatorio-os`: o nome da seção ("Fotos da execução").

## Prints
`docs/prints/acabamento-temas-4-5-6/` — desktop e celular.
