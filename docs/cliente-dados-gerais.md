# Cliente — Dados gerais: autofill pelo CNPJ e layout reorganizado

Melhora a aba **Dados gerais** do cliente (em cima do enxugamento de abas, #146). Sem mudança de
schema.

## Parte 1 — A consulta de CNPJ também preenche o endereço (e oferece um contato)

A rota `/api/cnpj/[cnpj]` já devolve o endereço completo e o contato (logradouro, número,
complemento, bairro, CEP, município, UF, e-mail, telefone) — antes só a razão social e o nome
fantasia eram aproveitados. Agora, ao clicar em **Consultar**, a **mesma resposta** preenche também:

- **Endereço principal** (sem 2ª chamada ao ViaCEP): como o endereço virou lista,
  - se o cliente ainda **não tem** endereço, cria o **principal** ("Matriz") preenchido;
  - se **já tem**, **não sobrescreve** — preenche só os campos **vazios** do principal.
- **Contato**: se vier e-mail/telefone e ainda não houver contato igual (mesmo e-mail, ou mesmo
  telefone quando não há e-mail), adiciona um contato; **nunca duplica**.
- Inscrição estadual não vem na consulta federal → fica como está (não inventa valor).
- Erros tratados com mensagem curta e profissional (a rota já devolve CNPJ inválido / não
  encontrado / serviço indisponível / timeout); nada trava o resto do formulário.

As regras de mescla ficam numa função **pura e testável** (`lib/cadastros/autofill-cnpj.ts`):
`mesclarEnderecoPrincipal` e `mesclarContato`. No cliente **novo**, a consulta mescla direto no que
vai ser salvo. Na **edição**, a consulta vira sugestão para os managers de endereço/contato: abrem o
formulário "Novo endereço"/"Novo contato" já preenchido pela consulta, para o usuário revisar e
salvar (nada é gravado em silêncio, e o que já existe não é sobrescrito).

## Parte 2 — Layout da aba Dados gerais reorganizado

Quatro seções (`FormSection`, cabeçalho em maiúsculas com ícone), nesta ordem:

1. **Identificação** — logomarca **compacta** + dados básicos (tipo de pessoa, CNPJ com Consultar,
   razão social, nome fantasia, inscrição estadual, status financeiro). Dois campos por linha no
   desktop, empilhando no celular.
2. **Endereços** — logo abaixo da identificação (o Consultar preenche os dois juntos). Lista em
   cards compactos: adicionar, editar, excluir e marcar principal.
3. **Contatos** — lista em cards compactos: adicionar, editar, excluir.
4. **Comercial** — tabela de preços (seletor compacto).

A logo ganhou uma variante `compacto` (preview menor, dica inline) para caber ao lado dos dados
básicos sem poluir.

Afinação da seção Identificação:
- O **status financeiro** fica **só no cabeçalho** (selo ao lado do nome) — não se repete numa
  linha no corpo da seção.
- O aviso **"Dados encontrados na Receita Federal"** deixou de ser um painel: virou uma linha
  **discreta em verde** logo **acima** do campo de CNPJ (`data-cnpj-encontrado`), sem ocupar espaço.
- **Endereços em caixas (acordeão), não cartões:** cada endereço é uma **caixa arredondada com fundo
  suave** (`bg-frivo-50`) — só o nome em negrito e o selo **Principal** no cabeçalho, com uma seta que
  gira ao abrir. Clicar **expande pra baixo** (painel branco) para ver todos os dados do endereço —
  melhor quando há vários. O selo **Principal** é texto só, sem ícone de estrela (sem "emoji"). Vale
  para o cliente novo (`UnidadesLocal`) e para a edição (`UnidadesManager`, que mantém o selo de
  distância "da empresa" no cabeçalho).

## Testes

- `autofill-cnpj` (função pura): cria principal quando vazio; preenche só os vazios quando já existe
  (não sobrescreve); contato não duplica (e-mail/telefone); sem e-mail nem telefone não adiciona.
- `cliente-cnpj-autofill-ui` (DOM): no cliente novo, Consultar preenche razão social, cria o endereço
  principal e um contato; consultar duas vezes não duplica.
- `cliente-abas-enxugar-ui`: as 4 seções de Dados gerais (Identificação, Endereços, Contatos,
  Comercial), com Endereços antes de Contatos.
- Rodada de mutação (6/6 mortas); ratchet, ux2-cliente e a suíte completa (PG real) verdes.

## Prints

Em `docs/prints/cliente-dados-gerais/` (desktop e celular): a aba reorganizada e o resultado da
consulta de CNPJ (endereço + contato preenchidos).
