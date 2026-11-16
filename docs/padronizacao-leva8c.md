# Padronização de telas — leva 8C (Financeiro: custo de pessoal e fiscal)

Terceira e última fatia da leva 8.

| | Escopo | Estado |
|---|---|---|
| **8A** | o que mexe no caixa: índice, fluxo de caixa, ficha e formulários da conta a pagar, cobrança nova | no master |
| **8B** | faturar e medir: ficha da medição e da fatura avulsa, formulário e faturamento de contratos | no master |
| **8C** (este PR) | **custo de pessoal e fiscal**: `/financeiro/custo-pessoal`, `/colaborador/[id]`, `/importar`, `/encargos` (guarda), `/financeiro/fiscal` e `/financeiro/notas-fiscais` | aqui |

**Não tem alteração de banco (🟢).** Nenhum arquivo em `prisma/sql/`, nenhuma mudança de schema,
nenhum dado migrado.

## Prioridade nº 1 — o levantamento deu limpo

Diferente da 8A e da 8B, **nada estava aberto aqui**. Todas as seis telas já barravam na própria
rota, e cada API confere de novo:

| Tela | Trava | Onde |
|---|---|---|
| `/financeiro/custo-pessoal` | Financeiro › Custo de pessoal | na página |
| `/financeiro/custo-pessoal/colaborador/[id]` | Financeiro › Custo de pessoal | na página |
| `/financeiro/custo-pessoal/importar` | Financeiro › Custo de pessoal | na página |
| `/financeiro/custo-pessoal/encargos` | Financeiro › Custo de pessoal | na página |
| `/financeiro/fiscal` | Financeiro › Fiscal | em `TelaDadosFiscais`, o componente que a rota do Financeiro e a gaveta de Configurações reusam |
| `/financeiro/notas-fiscais` | Financeiro › Fiscal | na página |

Os prints `*-so-visualiza.png` mostram as seis, antes e depois, com um usuário que só tem
`financeiro.visualizar`: todas param em **/sem-permissão**, nas duas fases.

> Registro honesto: eu cheguei a achar que `/financeiro/fiscal` estava sem trava (a página é só uma
> casca de três linhas) e cheguei a duplicar a conferência nela. O print do "antes" mostrou o
> redirecionamento acontecendo, fui ver de perto e a trava já estava no componente. **Desfiz a
> duplicação** — ficou como estava, e o teste passou a cobrar a trava onde ela mora, mais a garantia
> de que a rota continua usando a tela travada.

O lado do servidor está provado em PostgreSQL real: **fechar o mês, importar planilha, ler e gravar
os dados financeiros do colaborador** respondem 403 sem `financeiro.folha`; **o emitente de NFS-e e
a emissão** respondem 403 sem `financeiro.fiscal`; sem sessão, 401. Em todos os casos o retrato do
banco (fotos do mês, dados de folha, salários, cadastro, dados fiscais e notas) fica **idêntico ao
de antes da chamada**.

## Tela a tela — o que existia × o que mudou

### `/financeiro/custo-pessoal` — a mais mexida

| Antes | Depois |
|---|---|
| tabela escrita à mão (`<table>` + `<tfoot>` de totais) e uma segunda lista de cartões para o celular | **TabelaPro**: colunas escolhíveis (botão "Colunas"), cartões no celular pela mesma fonte |
| totais no rodapé da tabela | totais na **faixa da tabela** (a casa não tem rodapé de tabela); no celular, o título "Por colaborador · 5 ativos" |
| sem ⓘ | ⓘ no título: de onde vem o custo, o que são os encargos e o que "Fechar o mês" guarda |
| "4 colaborador(es) com dados", "4 técnico(s)", "1 colaborador(es) sem salário/dados de folha", "5 ativo(s)" | plural escrito: "4 colaboradores com dados", "4 técnicos", "1 colaborador sem salário ou dados de folha", "5 ativos" |
| "Mês fechado (5 colaboradores)" em verde, fixo ao lado do botão | **toast**: "novembro de 2026 fechado: 5 colaboradores (4 com dados) na foto do mês." — e o **erro continua na tela**, ao lado do botão |
| números com classes soltas | tokens `PLANILHA.numero` (alinhado pelos algarismos) |
| lista vazia escrita na tela | `ListaVazia` da casa |

A coluna **Descontos** nasce oculta (fica no menu "Colunas"): é a que menos se olha e a que mais
empurrava a tabela. "Colaborador" e "Custo total" são obrigatórias.

O aviso laranja de ferramenta de gestão **ficou**: não é instrução de uso (que iria para o ⓘ), é
ressalva sobre o dado — a tela estima, não substitui a folha oficial nem o contador.

### `/financeiro/custo-pessoal/colaborador/[id]`

| Antes | Depois |
|---|---|
| sem ⓘ | ⓘ no cabeçalho: o que a ficha alimenta (custo-hora da margem), de onde vêm os encargos e que **alterar aqui não muda mês já fechado** |
| "✓ Dados financeiros salvos" verde, fixo na tela | **toast** "Dados financeiros salvos."; o erro de digitação ("Confira os valores: use números como 3200,00") e o erro do servidor **continuam na tela** |

### `/financeiro/custo-pessoal/importar`

| Antes | Depois |
|---|---|
| a instrução no subtítulo do cabeçalho ("Planilha CSV ou Excel → mesmo cadastro de Equipes → Colaboradores (o CPF evita duplicar)") | subtítulo curto + **ⓘ** com a explicação inteira, incluindo que nada é gravado antes da conferência |
| "8 novo(s) e 1 atualização(ões)", "8 colaborador(es) criado(s)", "1 linha(s) com erro, não importada(s)" | plural escrito na prévia e no resultado: "8 colaboradores novos e 1 atualização", "1 linha com erro fica de fora", "2 já cadastrados, ignorados" |

### `/financeiro/custo-pessoal/encargos`

Já estava no padrão (CadastroPadrao, ⓘ, toast, trava). **Não foi tocada** — entrou só como guarda de
teste, para não regredir.

### `/financeiro/fiscal` (emitente de NFS-e)

| Antes | Depois |
|---|---|
| sucesso do cadastro no PlugNotas aparecia **duas vezes**: toast **e** recado verde na tela | só **toast**; a tela guarda o que precisa de leitura demorada: **pendências** (amarelo) e **erro** (vermelho) |

O resultado de "Testar conexão" continua na tela de propósito: é leitura de diagnóstico, não
confirmação de ação.

### `/financeiro/notas-fiscais`

A central já nasceu no padrão (TabelaPro, filtros na URL, ⓘ, toast). **Não foi tocada** — entrou
como guarda de teste.

## O que esta leva não encostou

- **cálculo da folha** (`lib/folha/calculo.ts`) e montagem das linhas;
- **importação** (`lib/folha/planilha.ts`, `lib/folha/importacao.ts`) e as rotas de folha;
- **emissão de NFS-e** (`lib/nfse/*`) e o vínculo nota ↔ medição/conta a pagar;
- **Desempenho**: o vínculo com o custo de pessoal é o **CSV do fechamento**
  (`csvDoFechamento` → `GET /api/desempenho/fechamentos/[id]/exportar`), intocado.

Isso não é promessa: um teste compara, com `git diff` contra o merge-base do master, a lista desses
arquivos — se qualquer um deles mudar, o teste cai.

**A única exceção, consciente:** `lib/folha/server.ts` ganhou **uma linha** no retorno de
`fecharMes` — a contagem `comDados`, para o toast poder dizer "5 colaboradores (4 com dados)". O que
é **gravado** não mudou: a foto é montada e escrita do mesmo jeito, e o teste de PostgreSQL confere
o conteúdo (bate centavo por centavo com `calcularCusto`). Um teste de fonte cobra que só o retorno
mudou: as três linhas que montam, apagam e gravam a foto continuam ali.

> O brief citava `modulo-custo-de-pessoal-folha.md` como referência do vínculo. Esse arquivo não
> existe em `docs/` (o que há sobre fechamento e folha de bônus está em `docs/desempenho.md`). Usei
> o código como referência — `lib/desempenho/fechamento-server.ts` e a rota de exportar.

## Folha e NFS-e são razão: nada se apaga

- nenhuma rota de folha ou de nota expõe `DELETE`; nenhuma tela da leva chama `method: "DELETE"`;
- **refazer o fechamento substitui** a foto daquela competência (apaga e regrava numa transação, só
  daquele mês) — provado: refazer não duplica, não encosta em outro mês nem na outra empresa;
- **reajuste depois do fechamento não muda mês fechado** (provado no banco real);
- modelo de encargos em uso **inativa**, não apaga (comportamento que já existia, agora com guarda).

## Testes

Três arquivos novos, 49 casos:

- `tests/unit/padronizacao-leva8c.test.ts` — guardas de fonte: trava em cada tela e cada rota,
  TabelaPro sem `<table>` à mão, totais na faixa, tokens de planilha, ⓘ em todas as telas, plural
  escrito, toast no sucesso e erro na tela, nenhuma porta de exclusão, e o diff contra o master nos
  arquivos de cálculo/emissão/vínculo;
- `tests/unit/padronizacao-leva8c-pg.test.ts` — PostgreSQL real: 403/401 com o **banco idêntico**
  antes e depois; a foto do mês batendo **centavo por centavo** com `calcularCusto` sobre os mesmos
  dados; detalhamento dos encargos e autor gravados; refazer substitui; mês futuro recusado;
  isolamento entre empresas;
- `tests/unit/padronizacao-leva8c-ui.test.ts` — DOM de verdade: confirmação e toast do fechamento
  (singular e plural), 403 que fica na tela sem atualizar, toast da folha do colaborador, valor
  digitado errado que nem chega ao servidor, plural escrito na prévia e no resultado da importação.

**Teste existente atualizado (1):** `nfse-dados-fiscais-ui.test.ts` cobrava o recado verde de
sucesso **e** o toast. Agora cobra o toast e exige que o recado **não** fique na tela — é a mudança
intencional desta leva, não um teste afrouxado.

**Mutação: 8 quebras propositais, 8 pegas.** Tirar a trava da tela do emitente, trocar o toast do
fechamento por recado na tela, atualizar a tela mesmo com 403, voltar ao plural abreviado, afrouxar
a permissão da rota de fechar o mês, fazer o refazer não substituir a foto, tirar o ⓘ do título,
sumir com o "(4 com dados)" do toast.

Suíte inteira verde.

## Prints

`docs/prints/padronizacao-leva8c/` — 51 arquivos, `antes-*` e `depois-*`, desktop e celular:

- `lista-colaboradores*` — a tabela à mão × a tabela da casa (e os cartões no celular);
- `custo-pessoal*`, `colaborador*`, `importar*`, `encargos*`, `fiscal*`, `notas-fiscais*` — as telas;
- `custo-pessoal-dica*` — o ⓘ aberto (só existe no depois);
- `colaborador-salvo*` e `fechar-mes-aviso*` — o recado verde × o toast;
- `fechar-mes-confirmacao` — a pergunta antes de gravar a foto;
- `*-so-visualiza` — as seis telas com quem só tem `financeiro.visualizar`.

Duas observações de print, não de produto: o breadcrumb mostra "P-t-bia" porque o banco de prints
usa ids legíveis — com id de verdade (cuid) o breadcrumb escreve "Detalhes"; e o toast da casa nasce
no canto superior direito, por cima do nome do usuário no cabeçalho (comportamento compartilhado,
igual ao das levas anteriores).

## ❓ Para conferir

1. **O toast do fechamento mostra os dois números — decidido pelo Zé.** A foto fotografa **todos os
   colaboradores ativos** (quem está sem salário entra com custo zero) e o card conta só quem tem
   dados; o toast agora diz "5 colaboradores (4 com dados)", para os dois números não parecerem
   erro. Quando todos têm dados o parêntese não aparece (repetiria o mesmo número).
2. **Coluna Descontos oculta por padrão.** Foi escolha minha para a tabela caber sem rolagem
   horizontal no notebook. Fica a um clique em "Colunas", e a escolha é lembrada por usuário.
