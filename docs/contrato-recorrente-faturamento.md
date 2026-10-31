# Contrato recorrente: cobrança mensal automática

Plano para a mensalidade do contrato sair sozinha todo mês: medição → NFS-e → boleto. Reaproveita o
motor da medição/fatura e o módulo fiscal, com as mesmas travas, sem caminho paralelo.

## Como funciona hoje (antes do plano)

| Etapa | Hoje |
|---|---|
| Previsão | Ao salvar o contrato ATIVO, nasce uma conta PREVISTO por mês (da competência atual até o fim; sem fim, ~12 meses). Sempre mensal. |
| Cobrança | Manual: "Gerar medições do mês" (uma medição por cliente) → enviar → aprovar (à mão ou pelo link do cliente) → NF → boleto → pagamento. |
| NFS-e | Manual, pelo módulo fiscal, a partir da medição. Até o PR2, o item da mensalidade nascia sem serviço → pendência "escolha o serviço do catálogo". |
| Boleto | Manual, por conta, no Contas a Receber (Inter). |
| Rotina (cron) | Não há rotina de faturamento. |

## PRs

| PR | O quê | Banco | Situação |
|---|---|---|---|
| **PR1** | Base: excluir encerra o financeiro; editar valor/dia/vigência sincroniza as previsões abertas; eventos na linha do tempo; "Gerar medições do mês" respeita a vigência; texto da periodicidade. | 🟢 | Feito (35231478/frivo#111) |
| **PR2** | **Serviço padrão do contrato**: `contratos.servico_id`. A medição do contrato nasce com o serviço no item (NFS-e sem a pendência) e com as retenções do serviço. Prévia no formulário: cobrança − retenções = cobrado. | 🔵 | Este PR |
| PR3 | Rotina diária: flags de automação no contrato, tabela de execuções (contrato × competência), etapas medição → aprovação → NFS-e → boleto, tela "Faturamento de contratos", falhas no sino. | 🔵 | Depende de D3, D4, D6, D7 |
| PR4 | Horizonte rolante de previsões e reajuste anual. | 🟢 | Depende de D8 |

## Regras do PR2

- O serviço padrão é **opcional** no banco. Sem ele, tudo segue como antes: o item nasce sem serviço e a nota fica pendente até alguém escolher. O formulário avisa.
- Com ele, o item da mensalidade (gerar-mes) nasce com `servicoId`. As **retenções** são herdadas pela mesma regra do "Faturar" (`retencoesHerdadas`): uma retenção só vale quando todos os serviços com valor da medição a marcam; item sem serviço (ex.: adicional consolidado de OS) não retém, então ela fica para o "Editar".
- Escolha nova precisa ser um serviço **ativo** da empresa; manter o atual (mesmo inativo) vale. Apagar o serviço não apaga o contrato (`ON DELETE SET NULL`).
- A previsão (conta PREVISTO) continua pelo valor mensal bruto. A conta da medição sai pelo líquido (valor − retenções) quando a medição é aprovada, como em toda medição com retenção.

## Decisões em aberto (do levantamento)

| # | Pergunta | Sugestão |
|---|---|---|
| D1 | Periodicidade trimestral/semestral/anual de cobrança, ou só mensal? | Só mensal por enquanto (texto já corrigido no PR1) |
| D2 | Dia de faturamento: do contrato ou do cliente? | Do contrato; sem ele, o do cliente |
| D3 | Uma medição por cliente (soma contratos) ou por contrato? | Por contrato no automático |
| D4 | Aprovação automática: todos, por contrato ou só o perfil AUTOMÁTICO? | Por contrato |
| D5 | A NF descreve o mês corrente ou o anterior? | Corrente, com opção no contrato |
| D6 | Boleto junto com a NF? Envio por e-mail automático? | Sim e sim |
| D7 | Falha: quantas tentativas e quem é avisado? | 3 (1 por dia) e o sino de quem tem Financeiro |
| D8 | Reajuste anual automático agora ou depois? | Depois (PR4) |
| D9 | Ao editar o valor, atualizar as previsões já criadas? | Feito no PR1 (só as abertas) |
