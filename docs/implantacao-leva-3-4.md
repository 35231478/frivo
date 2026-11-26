# Implantação, levas 3 e 4: tela de Implantação e cadastros simples

Para a Termofrio (e qualquer empresa nova) seguir um passo a passo só, vendo o que já está cadastrado, e
subir por planilha o estoque inicial, os colaboradores e os veículos.

## Levantamento: o que existia × o que mudou

| Peça | Antes | Agora |
|---|---|---|
| Passo a passo de implantação | Não existia | Cartão **Implantação** em Configurações › Conta › Empresa, sempre disponível: 7 etapas com **contagens reais**, atalhos de importação e o modelo de cada planilha |
| Painel (dashboard) | — | Faixa **"Implantação: N de M etapas · Próxima: …"** no topo, até chegar a 100%. Depois sai do painel e fica só em Configurações |
| Estoque inicial | Só pela tela, produto a produto (inventário) | Planilha **estoque**: o saldo de cada produto já cadastrado, com **custo opcional** |
| Colaboradores | Planilha só em Financeiro › Custo de pessoal (com salário, exige "Folha") | Planilha **colaboradores** do cadastro operacional, **pelo CPF**, **sem salário** (Equipes › gerenciar). A da folha continua igual |
| Veículos | Só pela tela | Planilha **veículos**, **pela placa**, com o responsável pelo CPF |
| Onde fica o botão | — | "Importar planilha" nas listas de **Estoque**, **Colaboradores** e **Veículos**, e em cada etapa da Implantação |

Não foram tocadas as telas de cadastro de clientes, OS e orçamentos.

**🔵 Banco: uma coluna nova, aditiva** (para o "Não se aplica / fazer depois"):
`configuracoes.implantacao_dispensadas` (lista de etapas, vazia por padrão), em
`prisma/sql/2027-01-29_implantacao_dispensadas.sql`. **Não aplicado**: precisa entrar antes do código.
As planilhas usam só o que já existe (`produtos`, `movimentacoes_estoque`, `tecnicos`, `cargos`, `veiculos`).

## A tela de Implantação

- **Etapas, na ordem em que as planilhas dependem umas das outras:**
  1. Empresa e configurações: dados da empresa (CNPJ e endereço), logo, tipos de OS; usuários (só a contagem).
  2. Clientes, unidades e contatos.
  3. Equipamentos.
  4. Estoque inicial: produtos que controlam estoque e quantos já têm saldo lançado.
  5. Colaboradores.
  6. Veículos.
  7. Contratos e PMOC (ainda sem planilha: vem na leva 6).
- **Feita** quando o mínimo existe: 1 cliente, 1 equipamento, 1 produto com saldo lançado, 1 colaborador, 1 veículo, 1 contrato **ou** 1 plano PMOC. A empresa pede dados, logo e ao menos 1 tipo de OS.
- **Módulo desligado tira a etapa** (e ela não conta para os 100%): Equipamentos, Estoque, Frota; Contratos e PMOC só some com os dois desligados.
- **"Não se aplica / fazer depois"** em cada etapa ainda não feita: **conta como concluída** para os 100% e pode ser
  **reaberta**. Feita de verdade vence a marcação. Ex.: quem começa sem contratos não fica com o destaque preso no painel.
- **Progresso** arredondado para baixo (6 de 7 = 85%, nunca 100% antes da hora), com "· N para depois" quando há marcadas.
- **Atalhos:** o botão de importar (só para quem pode importar aquela planilha, com o módulo ligado), o link do modelo (.xlsx) de cada planilha e "Abrir a lista". Importar recarrega as contagens.
- Os itens da etapa 1 abrem a configuração certa (Dados da empresa, Tipos de OS, Usuários) na gaveta.
- **Quem vê:** o cartão e o destaque pedem **Configurações › Gerenciar** (a mesma dos Módulos).

## As planilhas novas

### Estoque inicial (`estoque`)

- **Colunas:** `codigo`, `produto` (nome), `quantidade` (obrigatória), `custo_unitario`, `id_sistema`.
- **Produto:** pelo código → id_sistema → nome (sem acento e maiúsculas). O produto **precisa existir** (a planilha de produtos vem antes) e **controlar estoque**; inativo = erro. Nome em 2 produtos = erro ("use o código").
- **Quantidade = o saldo contado** (o saldo final), não o que entra:
  - subiu → uma **ENTRADA de origem Inventário** pela diferença, **com o custo**: vira o último custo de compra do produto e alimenta custo e margem do orçamento;
  - desceu → **ajuste de inventário**, sem custo;
  - igual → **nada é lançado** (reimportar a mesma planilha não mexe no estoque).
  - Produto que já tem movimentação: aviso "entra só a diferença".
- **Custo:** a coluna **só existe** para quem vê custo (Estoque › visualizar ou Orçamentos › ver custo; nunca o papel Técnico). Para os outros, ela some do modelo, da planilha baixada, do ligar colunas e da leitura.
- Cada lançamento leva a observação "Saldo inicial (planilha de implantação)" e quem importou.
- **Permissão:** importar = Estoque › gerenciar; baixar = Estoque › visualizar. Módulo Estoque desligado = 403.

### Colaboradores (`colaboradores`)

- **Colunas:** `nome`, `cpf` (obrigatórias), `telefone`, `email`, `funcao`, `equipe`, `cargo`, `crea`, endereço, `observacoes`, `id_sistema`.
- **Chave:** id_sistema → **CPF comparado só pelos dígitos** ("900.000.000-01" = "90000000001"). Grava formatado.
- **CPF novo precisa ser válido** (dígitos verificadores). O que já está no cadastro casa como está, mesmo antigo.
- **CPF não muda pela planilha** (é a identidade da pessoa): corrige-se na ficha.
- CPF que já está em 2 cadastros: sem o id_sistema, erro; com ele, é o id que decide.
- **Sem telefone:** o colaborador **entra com aviso** (na prévia e no resultado): o app e o WhatsApp precisam dele,
  mas não trava a implantação. Grava vazio, como a planilha da folha.
- **Função** vazia = Técnico de campo; **equipe** vazia = pela função (técnico e motorista = campo; o resto = administrativo), a mesma regra da planilha da folha.
- **Cargo:** casa com os cargos **ativos da empresa** (sem acento e maiúsculas). O que **não existe é criado**, uma vez só
  (mesmo com várias linhas e grafias), e o resultado lista **"Cargos criados (revise em Configurações › Cargos)"**.
  Cargo **inativo** = erro: não é recriado nem reativado.
- **Nunca entram:** salário, benefícios, perfil de acesso, login, dados bancários e documentos pessoais.
- **Permissão:** importar e **baixar** = Equipes › gerenciar (baixar leva CPF, telefone e endereço para fora do sistema).

### Veículos (`veiculos`)

- **Colunas:** `placa`, `modelo` (obrigatórias), `marca`, `ano`, `ano_modelo`, `tipo`, `combustivel`, `cor`, `chassi`, `renavam`, `quilometragem`, `responsavel_cpf`, `observacoes`, `id_sistema`.
- **Chave:** id_sistema → **placa** comparada sem hífen, espaço e ponto ("frv-9a11" = "FRV9A11"). Placa antiga ou Mercosul; outra coisa = erro. Grava sem hífen.
- **A placa não muda pela planilha**; placa gravada de 2 jeitos no cadastro: sem o id_sistema, erro.
- **Responsável:** pelo CPF de um colaborador **desta empresa**.
- **Tipo** vazio = Carro (ao cadastrar); aceita "furgão" (Van), "caminhonete" (Caminhão)…
- **Permissão:** importar = Frota › gerenciar; baixar = Frota › visualizar. Módulo Frota desligado = 403.

As três usam o mesmo motor das outras: prévia, erros linha a linha, **ligar colunas** (planilha de outro sistema), baixar → editar → subir pelo `id_sistema`. Nada é apagado.

## Decisões

1. **Implantação = Configurações › Gerenciar**, a mesma permissão dos Módulos: é quem configura a empresa.
2. **Contratos e PMOC contam para os 100%**, e toda etapa pode ser marcada **"Não se aplica / fazer depois"** (definido
   pelo Zé). A etapa de contratos fica sem planilha até a leva 6.
3. **Estoque: o produto precisa existir.** A planilha de estoque não cria produto; a de produtos já existe e vem antes (as duas estão na mesma etapa).
4. **Estoque que sobe entra como ENTRADA de origem Inventário** (e não como ajuste), para o custo virar o último custo de compra. As telas de compra (pedido, sugestão) continuam olhando só as compras de verdade.
5. **Custo só numa entrada:** no "igual" e na baixa, o custo não entra, com aviso na prévia.
6. **Colaborador sem telefone entra com aviso; cargo inexistente é criado** e listado para revisar (definido pelo Zé).
7. **CPF e placa não mudam pela planilha.** São a identidade do registro: mudar pela planilha seria fácil de errar.

## Perguntas respondidas pelo Zé

1. **Contratos/PMOC nos 100%:** toda etapa ganha "Não se aplica / fazer depois" → feito nesta leva (🔵, a coluna nova).
2. **Colaborador sem telefone:** aceitar com aviso na prévia e no resultado → feito.
3. **Cargo que não existe:** criar e listar "cargos criados" no resultado → feito.

## Testes

- **Puros + tela** (`implantacao-3.test.ts`, 28): estoque, colaboradores e veículos linha a linha; placa; a coluna de custo por permissão e papel; etapas, módulos, progresso e destaque; a tela de Implantação (contagens, atalhos por permissão e módulo, modelo, 100%); o destaque do painel; o assistente com o custo só para quem pode.
- **PostgreSQL real** (`implantacao-3-pg.test.ts`, 13): as rotas e o Prisma de verdade — entrada com custo e ajuste sem custo, reimportar sem lançar, produto com movimentação, custo por permissão e papel, ida e volta das três planilhas, CPF e placa repetidos, permissões e módulos desligados, contagens da Implantação por empresa.
- **SQL pendente:** rodado 3× num esquema vazio, aditivo, não apaga marcações e cria a coluna igual à do Prisma.
- **Testes antigos ajustados (mudança intencional):**
  - `navegacao-configuracoes.test.ts`: o grupo Empresa ganhou o cartão Implantação;
  - `codigos-exportacao.test.ts`: a tabela de "baixar planilha" ganhou estoque, colaboradores e veículos.
