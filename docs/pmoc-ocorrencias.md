# PMOC — Ocorrências

O registro das **não conformidades** achadas na manutenção dos equipamentos cobertos pelo plano
(vazamento, corrosão, ruído anormal, filtro danificado, falha elétrica…). É parte do livro de
registro do PMOC: as ocorrências entram no documento em PDF do plano.

Etapas anteriores: `docs/pmoc-etapa2-cronograma.md` (cronograma),
`docs/pmoc-etapa3-documento-alertas-envio.md` (documento, ART, avisos e envio) e
`docs/pmoc-renovacao.md` (renovação anual).

## Onde fica

Aba **Ocorrências** no editor do plano (`/pmoc/<id>?aba=ocorrencias`), entre Cronograma e
Histórico. A aba mostra o número de ocorrências **ainda não resolvidas**.

## O que cada ocorrência tem

| Campo | Regra |
|---|---|
| Data | Padrão hoje. Não pode ser futura. |
| Equipamento | Opcional. Vem da lista de Equipamentos AVAC **do próprio plano**. Sem equipamento, é "Geral da unidade". |
| Descrição do problema | Obrigatória (3 a 2.000 caracteres). |
| Gravidade | Baixa, Média, Alta ou Crítica. Obrigatória, sem valor pré-escolhido. |
| Situação | Aberta (padrão), Em andamento ou Resolvida. |
| Resolução | Só na Resolvida: data (padrão hoje; entre a data da ocorrência e hoje) e "o que foi feito" (opcional). |
| Foto ou anexo | Um arquivo: foto (JPG/PNG) ou PDF, até 3 MB. A foto é reduzida no navegador antes de enviar. |
| OS onde foi detectada | Opcional. Lista as OS **do cliente do plano**. Hoje é preenchida à mão. |

## O que dá para fazer

- **Nova ocorrência**, **Editar**, **Resolver** (diálogo com a data e o que foi feito), **Reabrir**
  (limpa a data e a observação da resolução), **Excluir** (com confirmação) e **Restaurar**.
- **Pesquisa** por descrição, resolução, equipamento (nome ou TAG), "geral" e número da OS — sem
  ligar para acento ou maiúscula. **Filtros** por situação e por gravidade, que se combinam.
- **Excluir não apaga**: a ocorrência sai da lista e do documento e fica guardada. O filtro de
  situação "Excluídas" mostra as excluídas, com o botão "Restaurar".
- Cada mudança deixa uma linha no **Histórico** do plano (registrada, alterada, resolvida,
  reaberta, excluída, restaurada), com quem fez.

## No documento em PDF

Seção **5. Ocorrências**, depois do planejamento e antes das assinaturas: uma frase com o resumo
("4 ocorrências: 2 abertas e 2 resolvidas") e a tabela **Data · Equipamento · Descrição ·
Gravidade · Situação**, da mais antiga para a mais nova. A resolvida traz a data e o que foi feito.
A excluída não entra. Plano sem ocorrência sai com a frase "Nenhuma ocorrência registrada…".

Vale para o documento baixado no sistema e para o do link público enviado ao cliente. As fotos
não entram no PDF.

## Permissões

| Ação | Permissão |
|---|---|
| Ver a aba, a lista e abrir o anexo | PMOC › Visualizar |
| Registrar, editar, resolver, reabrir, excluir e restaurar | PMOC › Editar |

A checagem é feita na tela (os botões somem) e no servidor (403). Técnico do app e quem não tem o
módulo PMOC recebem 403. Tudo é por empresa: plano de outra empresa responde 404. Plano inativo
só pode ser lido (mudança responde 409).

## Banco

Tabela nova `pmoc_ocorrencias` — `prisma/sql/2026-12-22_pmoc_ocorrencias.sql` (aditivo e
idempotente; rodar antes do merge). Gravidade, situação e origem são texto: nenhum enum.

A tabela já nasce com os vínculos opcionais das próximas etapas, hoje vazios:

| Coluna | Para quê |
|---|---|
| `ordem_servico_id`, `atividade_id` | A OS e a visita onde a ocorrência foi detectada. |
| `checklist_resposta_id` (única), `origem = 'APP'` | A resposta "Atenção" do técnico que a originou. |
| `orcamento_id`, `os_corretiva_id` | O orçamento ou a OS corretiva gerados a partir dela. |

## Fora desta etapa (pontas soltas)

1. A "Atenção com foto" que o técnico marca no app virar ocorrência automaticamente.
2. Gerar orçamento ou OS corretiva a partir de uma ocorrência.

Renovação e cópia do plano **não levam** as ocorrências: elas ficam no plano em que foram registradas.

## Onde está no código

- Regras (puras): `lib/pmoc-ocorrencias.ts`
- Servidor: `lib/pmoc-ocorrencias-server.ts`; rotas em `app/api/pmocs/[id]/ocorrencias/`
- Tela: `components/pmoc/pmoc-ocorrencias.tsx` (aba em `components/pmoc/pmoc-editor.tsx`)
- Documento: `lib/pmoc-documento.ts` (modelo) e `lib/pmoc-documento-pdf.ts` (seção 5)
- Testes: `tests/unit/pmoc-ocorrencias*.test.ts` e `tests/unit/sql-pmoc-ocorrencias.test.ts`
