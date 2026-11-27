# Exportar dados da empresa (backup portátil)

O administrador da empresa baixa um **.zip com os dados da empresa em planilhas**, para guardar por conta própria ou levar para outro sistema (direito de portabilidade da LGPD, art. 18, V). Fica em **Configurações › Conta › Empresa › Exportar dados**.

> 🔵 **Banco — NÃO aplicado.** A trilha das exportações precisa de uma tabela nova. O SQL está em
> `prisma/sql/2027-02-09_exportacoes_dados.sql`: aditivo, idempotente, sem tocar em outra tabela. O Zé aplica no Neon
> antes do merge. Sem a tabela, a rota falha **antes** de mandar o primeiro byte: nada sai sem registro.

## O que vai no pacote

Um CSV por planilha, mais um `LEIA-ME.txt` com a data, a empresa, quem gerou, o que cada arquivo tem, o formato e o que ficou de fora.

| Arquivo | Parte | Colunas |
|---|---|---|
| 01-clientes, 02-unidades, 03-contatos, 04-equipamentos, 05-fornecedores, 06-servicos, 07-produtos, 08-estoque (saldo + último custo), 09-colaboradores, 10-veiculos | Cadastros | **as mesmas da planilha de importação da Implantação**, com o `id_sistema` |
| 11-contratos, 12-pmoc | Cadastros | as mesmas da importação (contrato e PMOC não têm `id_sistema` na importação; contrato sai pela situação que a importação aceita: Ativo, Encerrado ou Cancelado) |
| 13-os, 14-os-itens, 15-os-atividades | Operação | colunas próprias (o cabeçalho da OS traz os totais somados pelos itens) |
| 16-orcamentos, 17-orcamentos-itens | Operação | colunas próprias (itens de serviço e de produto, com o tipo) |
| 18-contas-receber, 19-contas-pagar | Financeiro | colunas próprias |

Formato:
- CSV em **UTF-8 com BOM**, separador **`;`**, fim de linha CRLF. O Excel abre com acento certo em dois cliques.
- Aspas só quando a célula tem `;`, aspas, quebra de linha ou espaço nas pontas.
- Datas em `dd/mm/aaaa`; data e hora no horário de Brasília.
- Valores com vírgula decimal e sem separador de milhar (`1250,50`).
- O mesmo leitor da importação lê o arquivo de volta igualzinho: há um teste para isso.

**Fora do pacote:**
- Fotos, anexos, PDFs e assinaturas: ficam para a **próxima leva**.
- Colaboradores: a planilha leva só o cadastro operacional. A consulta **nem seleciona** salário, senha, banco/agência/conta/PIX, RG, PIS, CTPS, nome da mãe nem data de nascimento.
- Contatos: sem a senha do portal.
- Configurações, usuários e perfis.
- O que foi excluído: conta a receber excluída e plano PMOC excluído não voltam.

**Além da lista pedida:** fornecedores e serviços entram no pacote porque a importação de produtos, contas e contratos depende deles na hora de restaurar (pergunta 2 abaixo).

## Restaurar em outra empresa

Os 12 arquivos de cadastro sobem pela **Implantação** de outra empresa, nesta ordem: clientes, unidades, contatos, equipamentos, fornecedores, serviços, produtos, estoque, colaboradores, veículos, contratos, PMOC. A Implantação lê CSV com `;` e BOM.

Limites da importação que valem na volta:
- até 5.000 linhas e 5 MB por arquivo. Planilha maior se divide no Excel antes de subir;
- contrato entra **Suspenso** e o PMOC entra **Rascunho**: as regras da Implantação L6 continuam valendo;
- o `id_sistema` só casa dentro da mesma empresa. Em outra empresa, a linha vira registro novo.

OS, orçamentos e financeiro são **histórico para guardar e consultar**: não há importação para eles hoje.

## Como funciona

- **Quem pode:** só o **administrador** (ADMIN ou SUPER_ADMIN). O papel é conferido **no banco** a cada download: usuário ativo, desta empresa, com papel de administrador. Um cookie velho não basta.
  - Operador com todas as permissões, técnico, administrador desativado e usuário de outra empresa recebem 403.
  - O item nem aparece no menu para quem não é administrador.
- **Só a própria empresa:** toda consulta filtra por `empresaId`.
  - Os itens da OS e do orçamento, que não têm coluna de empresa, filtram pela empresa do pai.
  - O teste com duas empresas procura qualquer nome ou id da outra empresa no pacote inteiro.
- **Streaming e lotes** (`lib/zip-stream.ts`, `lib/exportacao/servidor.ts`):
  - o banco é lido em lotes de 500 registros, em ordem de id (cursor), e cada lote vira CSV e sai comprimido na hora;
  - a memória fica do tamanho de um lote, não da empresa inteira;
  - o download começa antes de o último arquivo existir;
  - o zip usa o "descritor de dados" do formato (bit 3), que o Windows, o macOS, o `unzip` e as bibliotecas leem.
- **Tempo da função:** a rota declara `maxDuration = 300` (5 min, como o cron).
  - Medida local: 30 mil contas a pagar saem em ~1,3 s (61 consultas, zip de 410 KB).
  - Em produção, cada consulta ao Neon custa a latência da rede: uma empresa com centenas de milhares de registros ainda cabe com folga.
  - Se um dia não couber, a tela oferece **baixar por parte** (`?parte=cadastros|operacao|financeiro`), e cada parte tem o seu próprio limite de 5 min.
  - Passou disso, o próximo passo é gerar em segundo plano e guardar o arquivo, o que pede armazenamento de arquivos (fora desta leva).
- **Trilha (`exportacoes_dados`):**
  - a exportação é gravada (empresa, usuário, nome, parte, quando) **antes** do primeiro byte;
  - ao terminar, ganha a hora de conclusão, o número de arquivos e o número de linhas;
  - se cair no meio (erro ou download interrompido), fica o motivo;
  - a que ficou sem conclusão por mais de 15 minutos aparece como "Não concluída";
  - a tela mostra as 20 últimas, com quem, quando, a parte e a situação;
  - `usuario_id` não tem chave estrangeira e o nome fica copiado, para a trilha sobreviver à exclusão do usuário. Apagar a empresa apaga a trilha dela (cascata).

## O SQL (prisma/sql/2027-02-09_exportacoes_dados.sql)

- Cria `exportacoes_dados` com o índice `(empresa_id, criado_em)` e a chave estrangeira para `empresas`, com `ON DELETE CASCADE`.
- `IF NOT EXISTS` e um bloco que ignora a chave já existente: rodar de novo não muda nada.
- Não apaga, não atualiza e não altera nenhuma outra tabela.
- Testado no PostgreSQL real: rodado 2×, com o dado gravado entre as rodadas preservado e o `migrate diff` contra o `schema.prisma` vazio.

## Testes

- `tests/unit/exportar-dados.test.ts` (puro):
  - o CSV e a volta pelo leitor da importação, os formatos e o catálogo;
  - o LEIA-ME, o nome do zip, quem pode exportar, a situação de cada exportação e o menu;
  - os lotes e o CSV em pedaços;
  - o zip em streaming validado pelo `zipfile` do Python (CRC, nome UTF-8, arquivo vazio e grande, erro no meio, limite de arquivos);
  - o `select` de colaboradores.
- `tests/unit/exportar-dados-ui.test.ts` (tela num DOM real): os links, a lista, o "gerando", o acompanhamento até concluir ou falhar, e o limite de tempo.
- `tests/unit/exportar-dados-pg.test.ts` (rota real + PostgreSQL real):
  - duas empresas com dados em todas as tabelas: vazamento, conteúdo de cada CSV e colunas iguais às da importação;
  - colaboradores sem dado sensível, permissão, trilha (antes do 1º byte, concluída, interrompida) e partes;
  - volume de 30 mil linhas em lotes, com o download começando antes do fim;
  - o SQL.
- Mutação: ver o PR.

## Perguntas em aberto (no PR)

1. **CPF dos colaboradores.** Fica na planilha porque é a chave da importação: sem ele, não dá para restaurar nem atualizar o colaborador. RG, PIS, CTPS, dados bancários, salário e nascimento ficam fora. Manter o CPF?
2. **Fornecedores e serviços** entram além da lista pedida, porque a importação de produtos, contratos e contas depende deles. Manter?
3. **Contrato restaurado:** a importação só aceita a situação Ativo, Encerrado ou Cancelado. Suspenso, Em renovação e Aguardando assinatura saem como "Ativo" e entram **Suspensos** na volta (regra da L6); Vencido sai como "Encerrado". Está bom assim?

## Próxima leva (anotada)

- **Fotos e anexos**: um segundo pacote, ou partes, com as fotos das atividades, os anexos da OS, do orçamento e do contrato, os documentos dos colaboradores e as ARTs do PMOC. Precisa decidir:
  - o tamanho (fotos pesam GB): provavelmente gerar em segundo plano e mandar o link por e-mail;
  - se os documentos pessoais dos colaboradores entram, e em que pasta.
