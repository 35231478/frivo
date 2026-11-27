# Implantação, leva 6: contratos e PMOC por planilha

Última leva da implantação. Os contratos de manutenção e os planos PMOC vigentes sobem por planilha, sem que
**nada seja cobrado, faturado, emitido ou agendado** até alguém revisar cada um pela tela.

## Levantamento: o que existia × o que mudou

| Peça | Antes | Agora |
|---|---|---|
| Etapa "Contratos e PMOC" da Implantação | Só a lista e o aviso "a planilha vem na última leva" | **Importar contratos** e **Importar planos PMOC**, cada um com seu modelo, e a nota de como entram |
| Contrato | Só pela tela. Salvar um contrato **Ativo** já gera a previsão de contas a receber e as OS recorrentes | Planilha **contratos**, que **só cadastra**. O "ativo" entra **Suspenso**, com tudo que cobra ou agenda desligado |
| PMOC | Só pela tela. Nasce em Rascunho | Planilha **pmocs**, que **só cadastra**, em **Rascunho**, com os equipamentos pelo número de série |
| Desfazer lote (leva 5) | Clientes, equipamentos e demais cadastros | + contratos e planos PMOC |
| Assistente de importação | "Existentes são atualizados" em todas as planilhas | Nas duas planilhas que só cadastram, diz isso e esconde a edição em massa |

Não foram tocadas as telas de cadastro de clientes, OS e orçamentos, nem nenhum código de cobrança, boleto,
NFS-e ou faturamento. A planilha só **não liga** nada disso.

**🟢 Sem banco.** Nenhuma tabela ou coluna nova. Os lotes usam as tabelas da leva 5 (o SQL `2027-01-30` está no
PR da leva 5).

## Por que o contrato "ativo" entra Suspenso

O sistema tem a regra **"só contrato ATIVO movimenta o financeiro e a recorrência"**. Desligar as chaves de
faturamento, boleto e NFS-e **não basta**: um contrato Ativo com valor mensal:
- ganha a **previsão de contas a receber** todo dia, pela rotina (horizonte rolante de 12 meses);
- entra no **"gerar medições do mês"**;
- gera **OS recorrentes** se tiver recorrência.

Por isso o contrato que a planilha diz "ativo" grava **Suspenso**. Suspenso não gera previsão, não entra nas
medições e não gera OS. Quando alguém revisa e muda para **Ativo pela tela**, o fluxo normal da tela roda (a
previsão nasce aí), com as chaves que essa pessoa escolher.

Além de Suspenso, o contrato nasce com estas chaves **desligadas** (gravadas explicitamente, sem depender do padrão do banco):
- faturamento automático, aprovação automática, NFS-e automática e boleto automático;
- recorrência de OS, renovação automática e reajuste (e o aviso dele);
- avisos ao cliente.

O **histórico de situação** do contrato registra "Importado por planilha (ativo na planilha): suspenso até a revisão".

## Planilha de contratos

| Coluna | Regra |
|---|---|
| `numero` | Vazio = o próximo da **numeração da empresa** (Configurações › Numeração de documentos). Número que já existe = erro: a planilha **só cadastra**; alterar um contrato mexe na cobrança e fica na tela |
| `cnpj_cpf` | Obrigatório. Cliente já cadastrado |
| `tipo` | Obrigatório. Aceita apelidos (preventiva, corretiva, completa, aluguel…) |
| `situacao` | Ativo (entra **Suspenso**), Encerrado ou Cancelado (entram como estão, para o histórico). Vazio = Ativo |
| `data_inicio` / `data_fim` | dd/mm/aaaa, aaaa-mm-dd ou data do Excel. 31/02 é erro, nunca vira "hoje". Fim antes do início é erro |
| `valor_mensal` | Fica gravado; a cobrança só começa quando o contrato for ativado |
| `periodicidade` | Vazio = Mensal |
| `dia_vencimento` | 1 a 31 |
| `unidades` | Nomes das unidades do cliente, separados por `;`. Vazio = a unidade **Principal** |
| `descricao_servicos`, `art_numero`, `observacoes` | Texto |

Não há colunas para faturamento automático, boleto, NFS-e, recorrência, renovação ou reajuste: isso é configurado
pela tela, na revisão.

## Planilha de PMOC

| Coluna | Regra |
|---|---|
| `cnpj_cpf` | Obrigatório. Cliente já cadastrado |
| `unidade` | Nome da unidade do cliente. Vazio = a **Principal** |
| `nome` | Obrigatório. O mesmo nome na mesma unidade é erro (já existe, ou repetido na planilha) |
| `data_inicio` / `data_expiracao` | Validade vazia = **12 meses** depois do início (fim de mês ajustado) |
| `equipamentos` | Números de série separados por `;`. Só equipamentos **ativos do mesmo cliente** (a regra da tela). Série em dois equipamentos = erro (vincule pela tela). Sem equipamentos = entra com aviso |
| `rt_nome`, `rt_crea`, `art_numero`, `descricao` | Texto |

O plano entra em **Rascunho**: não gera cronograma, OS nem aviso ao cliente até ser publicado pela tela.

## Desfazer lote

Contratos e planos PMOC entram no lote e no "Desfazer lote" da leva 5, com as mesmas regras.

- **O que a importação cria junto não conta como uso.** Para o contrato: as unidades cobertas e o histórico. Para
  o PMOC: os equipamentos vinculados e o histórico. Saem em cascata com o registro.
- **Ganhou uso depois, fica.** Contrato: OS, medição, conta, recorrência por local etc. PMOC: cronograma,
  execução, ocorrência, aviso. Também fica o **alterado depois** (ex.: o PMOC publicado ou o contrato ativado).
- **Permissão:** contrato pede **Contratos › Editar**, porque pela tela "excluir" um contrato é encerrá-lo com essa
  permissão. PMOC pede **PMOC › Excluir**. Módulo desligado segura.
- O cliente que ganhou um contrato pela planilha **fica** ao desfazer o lote de clientes: a unidade dele está no contrato.

## Decisões tomadas (para o Zé revisar)

1. **"Ativo" vira Suspenso.** É a única forma de nada ser cobrado sem mexer no código de cobrança (ver acima).
   - Se preferir outra situação, a troca é uma linha (`statusImportado` em `lib/importacao/entidades.ts`).
   - "Aguardando assinatura" também não gera nada, mas não aparece no formulário do contrato.
2. **Só cadastra.** Contrato e PMOC que já existem são erro na prévia. Por isso não há "baixar os cadastrados" nessas duas planilhas.
3. **Desfazer apaga o contrato importado sem uso.** Pela tela, contrato nunca é apagado (só encerrado). No desfazer, o contrato
   criado pelo lote e sem nenhum vínculo é apagado de verdade, como os outros cadastros da leva 5.
   - Se preferir que o desfazer **encerre** em vez de apagar, é decisão de produto: fica a pergunta.

## Testes

- `tests/unit/implantacao-6.test.ts` (13) cobre:
  - datas: formatos, 31/02, número do Excel e fim de mês;
  - o motor de contratos e de PMOC: apelidos, Principal, unidades, séries, validade padrão e erros;
  - permissões e módulos;
  - nenhuma coluna liga cobrança;
  - a etapa da tela, com permissão e módulo;
  - o assistente dizendo que só cadastra.
- `tests/unit/implantacao-6-pg.test.ts` (6, **PostgreSQL real**) cobre:
  - o contrato **Suspenso**, com todas as chaves desligadas e o número da numeração;
  - as **rotinas diárias de previsão e de OS recorrentes rodadas de verdade**: nenhuma conta a receber nem OS;
  - os erros;
  - o PMOC em Rascunho, sem cronograma, com os equipamentos;
  - o desfazer (usado fica, publicado fica, o resto sai com o que veio junto);
  - o cliente que ganhou contrato;
  - permissão e módulo desligado.
- **Mutação:** 45 mutantes, **45 mortos**. Cada um quebra uma regra (datas, contrato, gravação com cada chave, PMOC, desfazer, etapa, assistente).
  O único que sobreviveu à 1ª rodada (a gravação reconferir as unidades do cliente) virou teste.
- **Navegador real** (Playwright, banco local de prints): 13 conferências ok.
  Importar pela etapa → prévia com o aviso → resultado → no banco, contrato SUSPENSO com tudo desligado e nenhuma
  conta a receber; PMOC em Rascunho com os equipamentos; lotes listados.

## Prints

`docs/prints/implantacao-6-depois/` (dados fictícios). O ANTES é a etapa "Contratos e PMOC" nos prints da leva 5
(`docs/prints/implantacao-5-depois/20-celular-importacoes-lista.png`), com o aviso "a planilha vem na última leva".
