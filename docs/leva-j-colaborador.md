# Leva J — Colaborador

Seis pedidos do Zé sobre o cadastro do colaborador e a admissão. Prints antes e depois em
`docs/prints/leva-j-colaborador/` (dados fictícios, banco local; desktop e iPhone).

> 🔵 **Banco: aditivo**, em `prisma/sql/2027-02-13_colaborador_jornada_especialidades.sql`. **Rodar ANTES do merge.**
> - `tecnicos.jornada_faixas` (jsonb, nulo);
> - `configuracoes.mostrar_especialidades_tecnico` (boolean, padrão `true`).
>
> Nada é convertido nem apagado. Testado no PostgreSQL real: roda 2× e o `migrate diff` fica vazio.

## (1) Admissão pelo link: campos obrigatórios e CEP

- **Obrigatórios para o candidato:**
  - na etapa Dados: RG, data de nascimento, e-mail e celular;
  - na etapa Endereço: CEP, endereço, número, bairro, cidade e UF.
- **Validações:**
  - o celular exige DDD + 9 dígitos começando por 9; telefone fixo não serve;
  - o e-mail precisa ter cara de e-mail;
  - a UF tem de ser uma das 27, escolhida numa lista.
- O botão "Salvar e continuar" e a rota usam **a mesma conferência** (`faltaNaEtapa`).
- **Confirmação do e-mail por código:** só é pedida se a empresa tem o e-mail configurado. Sem e-mail configurado, o
  candidato segue.
- **CEP:**
  - preenche endereço, bairro, cidade e UF por uma função só, `lib/cep.ts` (`buscarCep`, `formatarCep`,
    `cepCompleto`);
  - a ficha do colaborador agora usa a mesma função;
  - ainda não há um componente global de CEP no master. Quando a varredura criar um, a troca é num lugar só.

## (2) Jornada em faixas

- **O que muda:**
  - antes: um conjunto de dias com **um** horário;
  - agora: até 7 **faixas**, cada uma com os seus dias, entrada, saída e intervalo opcional. Exemplo: Seg–Qui
    07:30–17:30 com almoço 12–13, e Sex 07:30–16:30.
- **Dia em duas faixas:** não pode. Na tela, o dia que já é de outra faixa aparece riscado e travado, com o número da
  faixa. A rota também recusa (400, "Faixa 2: Qui já está na faixa 1.").
- **Contador ao vivo:** horas de cada dia e da semana, descontando o intervalo. Cada faixa mostra as horas por dia.
- **Jornada errada não salva:** a mensagem diz a faixa, a aba "Dados profissionais" abre e ganha a marca de erro.
- **Compatível com o que já está gravado:**
  - quem não tem faixas abre com **uma** faixa, montada dos campos antigos (`jornada_dias`, `jornada_entrada`,
    `jornada_saida`), sem intervalo;
  - ao salvar, os campos antigos continuam preenchidos a partir das faixas: os dias de todas e o horário da 1ª;
  - um cliente antigo, que manda só os campos antigos, grava esses campos e **limpa as faixas**. Assim uma faixa velha
    não passa por cima do horário que acabou de ser salvo.
- **Contrato e documentos:** contrato da admissão, entrega da admissão e documentos do colaborador usam o mesmo texto.
  - Cada faixa sai no **mesmo formato de antes**, com o intervalo quando há. Exemplo: "07:30 às 17:30, de segunda a
    quinta, com intervalo de 12:00 às 13:00; 07:30 às 16:30, sexta, com intervalo de 12:00 às 13:00 — 44h semanais".
  - A jornada antiga (uma faixa sem intervalo) sai **exatamente como saía** ("08:00 às 18:00, de segunda a sexta"),
    sem as horas da semana. Assim os modelos de contrato das empresas continuam lendo igual.

## (3) "Tipo" e "Tipo de equipe": auditoria e decisão

**Onde cada campo é usado de verdade:**

| Campo | Uso real |
|---|---|
| `tipoEquipe` (Campo / Administrativo) | abas de **Equipes**; quem aparece no **mapa** (posição do técnico); importação de planilha; folha |
| `tipo` = Responsável técnico | quem pode ser **responsável técnico**: PMOC, contrato (ART), dados da empresa, orçamento (padrão do RT); o cadastro rápido de RT; pede o **CREA** |
| `tipo` = Técnico de campo ou Responsável técnico | **custo-hora dos técnicos** (custo de pessoal, `FUNCOES_CUSTO_HORA`); filtro "Técnicos" da lista |
| `tipo` = Técnico de campo | "técnicos próximos" da OS |

**O problema:** os dois campos têm uso, então nenhum podia sair. Mas "Técnico de campo" (tipo) e "Campo" (tipo de
equipe) diziam a mesma coisa em dois lugares e podiam discordar. Exemplo: "Administrativo" num e "Campo" no outro.

**A decisão:** dois conceitos claros, cada um com uma dica curta (ⓘ), no lugar dos dois selects.

- **"Usa o app de campo"** = `tipoEquipe`, a fonte única de "é de campo". A dica diz onde pesa: aba Campo de Equipes,
  mapa, técnicos da OS e custo-hora.
- **"Responsável técnico (ART/PMOC)"** = `tipo` RESPONSAVEL_TECNICO. Ligado, pede o CREA.

**Como fica no banco:**

- **Nenhuma coluna foi apagada.** Ao salvar, as duas são gravadas sempre coerentes (`lib/colaborador/funcao.ts`):
  - RT manda no `tipo`;
  - sem RT, o `tipo` segue o "campo": Técnico de campo ou Administrativo;
  - Motorista e Outro, que a tela não oferece mais, ficam como estão enquanto a pessoa não for RT.
- "Técnicos próximos" passou a seguir o "Usa o app de campo", em vez do `tipo`.
- O resto continua lendo as mesmas colunas, agora coerentes.

## (4) Competências

**Conferido:** a lista **já vinha** dos tipos de OS cadastrados pela empresa (`/api/tipos-os`, só os ativos). Não
havia lista fixa.

**Um ajuste:** se um tipo de OS for desativado, a competência já marcada **não some mais da tela**. Antes ela ficava
gravada sem aparecer. Agora aparece marcada, com "(inativo)", e dá para desmarcar. A rota continua recusando tipo de
OS de outra empresa.

## (5) Especialidades junto ao nome do técnico

Exemplo: "João Silva — especialista em VRF e Chiller".

- **Onde aparece:**
  - **na OS:** uma linha em cada atividade, para cada técnico que tem especialidade;
  - **no relatório da OS (PDF):** interno e o link do cliente, na seção Equipe. Entre pessoas o separador vira ponto e
    vírgula, porque a lista de especialidades usa vírgula;
  - **no portal do cliente:** no chamado, "Técnicos:" com quem executou as atividades. Antes aparecia só o
    responsável da OS.
- **Regras do texto:** até 4 especialidades, sem repetir. Quem não tem nenhuma aparece só com o nome.
- **Configuração:** Configurações › Impressão da OS › **"Mostrar especialidades do técnico"**, ligado por padrão.
  - Desligado, as três saídas mostram só o nome; a OS nem recebe as especialidades.
  - Salvar as seções sem a chave (tela antiga) não muda a chave.
  - A tela geral de Configurações manda a configuração inteira de volta ao salvar. Ela não sobrescreve a chave, como
    já acontece com os outros campos de rota própria.

## (6) A ficha do colaborador

- **As abas seguem o padrão da ficha do cliente:** quebram linha, sem rolagem lateral. No celular ganham um rótulo
  curto ("Pessoais", "Profissionais", "Folha"…) e ficam 3 por linha, em vez de uma por linha.
- A aba com erro ganha a marca (ⓘ vermelho), e o salvar recusado abre a primeira aba com erro.

## Testes

| Arquivo | O que trava |
|---|---|
| `leva-j-colaborador` (27, regra) | as horas da faixa e da semana; os erros de cada faixa e o dia repetido; a leitura da jornada antiga; a gravação dos campos antigos; o texto do contrato; o schema da rota; a função (ida e volta, motorista); as especialidades na atividade e no relatório; a chave padrão ligada; as amarras (competências da empresa, abas sem rolagem, SQL só aditivo) |
| `leva-j-colaborador-ui` (15, tela) | as abas; o contador ao vivo (intervalo, faixa nova, dia travado, liberar o dia); a jornada errada não salva e marca a aba; remover a faixa; os dois interruptores e o CREA; o motorista; o CEP (achou e não achou); as competências (o inativo só se marcado); a linha de especialidades na OS; o interruptor da configuração |
| `leva-j-colaborador-pg` (10, PostgreSQL real) | as rotas gravam as faixas e refazem os campos antigos; o cliente antigo limpa as faixas; 400 na sobreposição; competência de outra empresa recusada; o texto da jornada nos documentos; o relatório interno e o do link com e sem especialidades; a chave na configuração (tela antiga não muda, valor inválido 400); a tela geral de Configurações salva sem mexer na chave |
| `sql-leva-j-colaborador` (3, PostgreSQL real) | o SQL de produção: roda 2×, as linhas antigas ficam como estavam, empresa nova com a chave ligada, `migrate diff` vazio |

**Testes antigos atualizados de propósito:**

- `admissao-regras`, `admissao-pg` e `admissao-ui` passaram a exigir os campos novos.
- `tema6-datas-hora` (3): a jornada é lida e gravada pela faixa 1. Uma faixa sem entrada não salva e diz o que falta;
  sem faixa nenhuma, a jornada vai vazia.
- `impressao-os-ui` (1): salvar leva a chave das especialidades.
- Antes, `email: ""` servia de atalho para pular a confirmação do e-mail. Agora:
  - o teste confirma pelo código de verdade;
  - um teste novo prova que, sem e-mail configurado, o candidato segue.

**Mutação:** 39 mutantes, 39 mortos.
- O único sobrevivente da 1ª rodada foi "a tela antiga desliga a chave". O teste partia da chave desligada.
- Agora ele também confere com a chave ligada, e o mutante morre.
