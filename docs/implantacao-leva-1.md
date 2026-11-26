# Implantação, leva 1: clientes completos

Para a Termofrio subir os dados reais em dezembro, a importação de clientes precisava trazer também os
locais de atendimento (unidades) e as pessoas de contato. Também precisava aceitar a planilha exportada
de outro sistema (Field Control, Conta Azul) sem que ninguém renomeasse colunas.

## Levantamento: o que existia × o que mudou

| Peça | Antes | Agora |
|---|---|---|
| Motor de importação (`lib/importacao`) | Clientes, fornecedores, serviços e produtos. Prévia sem gravar, erros linha a linha, planilha de erros, não duplica, ida e volta pelo `id_sistema` | **Reusado.** Ganhou unidades, contatos, a ligação de colunas e a conferência entre linhas |
| Cliente importado | Nascia **sem unidade**, e equipamento e OS dependem de unidade | Ganha a unidade **"Principal"** com o endereço dele, na mesma transação |
| Unidades | Só pela tela, uma a uma | Planilha própria, ligada ao cliente pelo CNPJ/CPF |
| Contatos | O cliente tinha só um campo de texto "contato" | Planilha própria. Cria a pessoa de contato que portal, cobrança e aceite usam |
| Planilha de outro sistema | Recusada: "Faltam colunas obrigatórias: nome" | **Ligar colunas**: a pessoa diz de qual coluna vem cada informação |
| Botão "Importar planilha" de Clientes | Só clientes | Clientes → Unidades → Contatos, no mesmo lugar e na ordem certa |
| Linha que casa e não tem nada a mudar | Virava erro falso | Conta como atualizada (defeito achado nesta leva; valia também para fornecedor, serviço e produto) |

Nenhum arquivo de Clientes (lista, ficha, migalha) foi tocado. O botão que já estava na lista passa a abrir
o diálogo novo, que é compartilhado (`components/importacao`).

## Como funciona

### As três planilhas, nesta ordem

1. **Clientes**: como antes.
   - Cada cliente novo, e cada cliente que ainda não tem nenhuma unidade, ganha a unidade **"Principal"** com o endereço do cadastro (rua, número, complemento, bairro, cidade, UF, CEP e telefone).
   - Reimportar não cria outra.
2. **Unidades**: `cnpj_cpf` do cliente + `nome` da unidade (obrigatórios), `principal`, endereço, telefone e observações.
   - O mesmo nome no mesmo cliente (sem acento e sem maiúsculas) **atualiza** a unidade e não a renomeia.
   - `principal = Sim` passa a marcação para esta unidade; a anterior deixa de ser principal, na mesma transação.
   - `Não` ou vazio não muda nada: o cliente nunca fica sem endereço principal, como na tela.
   - Para usar a unidade criada junto com o cliente, chame-a de "Principal" na planilha.
3. **Contatos**: `cnpj_cpf` + `nome` (obrigatórios), cargo, tipo, e-mail, telefone, WhatsApp e `principal`.
   - O mesmo e-mail no mesmo cliente atualiza o contato; sem e-mail, vale o nome.
   - O tipo aceita o rótulo, o valor e apelidos: "chamados" vira Operacional, "dono" vira Diretoria.
   - **A planilha nunca cria acesso ao portal.**

Em todas as planilhas:
- o cliente é procurado **só na empresa da sessão**;
- um `id_sistema` de outro cliente, ou de outra empresa, vira erro;
- dois "Sim" de principal para o mesmo cliente: o segundo vira erro;
- baixar as unidades ou contatos cadastrados, editar e subir de novo atualiza pelo `id_sistema`.

### Ligar colunas (de-para)

- Quando falta uma coluna obrigatória, a tela abre **"Ligar colunas"** em vez de só recusar.
  - Cada coluna do modelo tem uma lista com as colunas da planilha, mais "não importar".
  - Vem preenchida com o que o sistema já reconheceu sozinho.
- "Aplicar e conferir" só libera com as obrigatórias ligadas.
- Uma coluna da planilha liga a uma coluna só: escolher de novo tira da anterior.
- A mesma ligação vai na prévia e na confirmação; um arquivo novo começa sem ligação.
- Com a planilha já aceita, "Conferir como as colunas foram ligadas" reabre o painel.
- No servidor:
  - o mapa só aceita colunas do modelo, com texto de até 200 caracteres ou "não importar", e no máximo 80 entradas;
  - o resto é recusado com "Ligação de colunas inválida".

## Decisões

1. **Formato:** planilhas separadas, ligadas pelo CNPJ/CPF (resposta do Zé).
2. **Unidade "Principal" automática:** na importação, também para o cliente que ainda não tem nenhuma unidade (resposta do Zé).
3. **Permissão:** importar unidades e contatos pede **Clientes › Editar**, a mesma regra de criar unidade ou contato pela tela. Quem só pode criar cliente vê só a planilha de clientes. Baixar as cadastradas pede **Clientes › Visualizar**.
4. **"Não" na unidade principal não tira a marcação.** A principal só troca quando outra unidade vem com "Sim".
5. **Ligar colunas não fica guardado.** A cada arquivo a pessoa liga de novo. Guardar a ligação por sistema de origem (um "perfil Field Control", por exemplo) é **uma leva futura**, quando o Zé confirmar a origem e tivermos uma planilha real.

## Testes

- **Puros + tela** (`implantacao-1.test.ts`, 17):
  - ligar colunas: a escolha da pessoa vence o automático, "não importar", coluna usada uma vez, validação do mapa, erro com o cabeçalho;
  - unidades e contatos: cliente da empresa, id de outro cliente, principal, chaves, um principal por cliente;
  - tela com o diálogo de verdade: família por permissão, texto de cada planilha, ligar colunas do começo ao fim, mapa na prévia e na confirmação, arquivo novo sem ligação, observações.
- **PostgreSQL real** (`implantacao-1-pg.test.ts`, 12):
  - "Principal" com o endereço, só em quem não tem unidade, e reimportar não duplica;
  - **cliente e unidade na mesma transação**: com um gatilho que recusa a unidade, o cliente também não fica;
  - planilha de outro sistema: o 400 traz o cabeçalho e, ligadas as colunas, grava;
  - unidades: troca da principal, erros linha a linha, ida e volta;
  - contatos: casa pelo e-mail e pelo nome, sem acesso ao portal;
  - permissão e multiempresa;
  - o update vazio.
- **As provas antigas da importação** (`leva-importacao.test.ts`, 37) continuam passando sem mudança.
