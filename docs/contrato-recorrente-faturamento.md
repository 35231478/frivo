# Contrato recorrente: cobrança mensal automática

Plano para a mensalidade do contrato sair sozinha todo mês: medição → NFS-e → boleto. Reaproveita o
motor da medição/fatura e o módulo fiscal, com as mesmas travas, sem caminho paralelo.

## Como funciona hoje (antes do plano)

| Etapa | Hoje |
|---|---|
| Previsão | Ao salvar o contrato ATIVO, nasce uma conta PREVISTO por período de cobrança (da competência atual até o fim; sem fim, ~12 meses). Até o PR3-A, sempre mensal. |
| Cobrança | Manual: "Gerar medições do mês" (uma medição por cliente) → enviar → aprovar (à mão ou pelo link do cliente) → NF → boleto → pagamento. |
| NFS-e | Manual, pelo módulo fiscal, a partir da medição. Até o PR2, o item da mensalidade nascia sem serviço → pendência "escolha o serviço do catálogo". |
| Boleto | Manual, por conta, no Contas a Receber (Inter). |
| Rotina (cron) | Não há rotina de faturamento. |

## PRs

| PR | O quê | Banco | Situação |
|---|---|---|---|
| **PR1** | Base: excluir encerra o financeiro; editar valor/dia/vigência sincroniza as previsões abertas; eventos na linha do tempo; "Gerar medições do mês" respeita a vigência; texto da periodicidade. | 🟢 | Feito (35231478/frivo#111) |
| **PR2** | **Serviço padrão do contrato**: `contratos.servico_id`. A medição do contrato nasce com o serviço no item (NFS-e sem a pendência) e com as retenções do serviço. Prévia no formulário: cobrança − retenções = cobrado. | 🔵 | Feito (35231478/frivo#112) |
| **PR3-A** | **Periodicidade de cobrança** (mensal a anual) + **rotina diária** medição → aprovação, com execuções (contrato × competência), 3 tentativas, sino e a tela "Faturamento de contratos". | 🔵 | Este PR |
| PR3-B | Etapas NFS-e (emissão automática) e boleto (+ envio por e-mail); colunas NF/boleto da tela passam a ser preenchidas pela rotina. | 🟢 | Depois do PR3-A |
| PR4 | Horizonte rolante de previsões e reajuste anual. | 🟢 | Depende de D8 |

## Regras do PR2

- O serviço padrão é **opcional** no banco. Sem ele, tudo segue como antes: o item nasce sem serviço e a nota fica pendente até alguém escolher. O formulário avisa.
- Com ele, o item da mensalidade (gerar-mes) nasce com `servicoId`. As **retenções** são herdadas pela mesma regra do "Faturar" (`retencoesHerdadas`): uma retenção só vale quando todos os serviços com valor da medição a marcam; item sem serviço (ex.: adicional consolidado de OS) não retém, então ela fica para o "Editar".
- Escolha nova precisa ser um serviço **ativo** da empresa; manter o atual (mesmo inativo) vale. Apagar o serviço não apaga o contrato (`ON DELETE SET NULL`).
- A previsão (conta PREVISTO) continua pelo valor mensal bruto. A conta da medição sai pelo líquido (valor − retenções) quando a medição é aprovada, como em toda medição com retenção.

## Regras do PR3-A

- **Periodicidade (D1).** Mensal, bimestral, trimestral, semestral ou anual, contada do início da vigência. O valor é o de **cada** cobrança (sem multiplicar). Sai uma previsão e uma medição por período, no 1º mês do período. Semanal/quinzenal (da recorrência de OS) valem como mensal; o seletor de cobrança só oferece as cinco.
- **Contratos existentes.** O SQL coloca todos como MENSAL uma vez só (como já cobravam). Rodar de novo não mexe mais.
- **Referência (D5).** Mensal: o item continua "Contrato N — mensalidade" e a previsão "Ref. MM/AAAA". A cada N meses: "Ref. jan–mar/2026". "Período anterior" (em Mais opções) descreve o período que passou.
- **Dia de faturamento (D2).** É o do contrato; sem ele, o do cliente. Vale para a previsão e para a medição de um contrato só, também na aprovação (manual, pelo link ou pela rotina).
- **Rotina (D3/D4/D6/D7).** Roda todo dia de manhã (`/api/cron/faturar-contratos`, com `CRON_SECRET`). Só para contrato com "Faturamento automático":
  - no dia de faturamento do mês corrente, cria a medição **do contrato** (uma por contrato);
  - "Aprovar sem esperar o cliente" ligado: aprova na hora. Desligado: manda por e-mail para o cliente aprovar e espera; e-mail que não sai vira pendência no sino;
  - falha: tenta de novo nos 2 dias seguintes; na 3ª vira "Falhou" e avisa no sino de quem tem Financeiro › Medições. "Tentar de novo" retoma de onde parou;
  - medição feita à mão só deste contrato é adotada; a consolidada com outros contratos encerra a execução com o motivo;
  - o "Gerar medições do mês" deixa os contratos automáticos para a rotina.
- **Travas.** Uma execução por contrato × competência (índice único). Posse da execução enquanto processa. O núcleo da medição tranca o contrato e confere de novo a competência. O número da medição sai sob trava. A aprovação é atômica.
- **Permissão.** Ligar ou desligar as chaves automáticas pede Financeiro › Medições, na tela e no servidor. A tela e o "Tentar de novo" também pedem.

## Decisões em aberto (do levantamento)

| # | Pergunta | Sugestão |
|---|---|---|
| D1 | Periodicidade trimestral/semestral/anual de cobrança, ou só mensal? | Decidido: a cada N meses, valor por cobrança (PR3-A) |
| D2 | Dia de faturamento: do contrato ou do cliente? | Decidido: do contrato; sem ele, o do cliente (PR3-A) |
| D3 | Uma medição por cliente (soma contratos) ou por contrato? | Decidido: por contrato no automático (PR3-A) |
| D4 | Aprovação automática: todos, por contrato ou só o perfil AUTOMÁTICO? | Decidido: por contrato (PR3-A) |
| D5 | A NF descreve o mês corrente ou o anterior? | Decidido: corrente, com opção no contrato (PR3-A) |
| D6 | Boleto junto com a NF? Envio por e-mail automático? | Sim e sim |
| D7 | Falha: quantas tentativas e quem é avisado? | Decidido: 3 (1 por dia) e o sino de quem tem Financeiro › Medições (PR3-A) |
| D8 | Reajuste anual automático agora ou depois? | Depois (PR4) |
| D9 | Ao editar o valor, atualizar as previsões já criadas? | Feito no PR1 (só as abertas) |
