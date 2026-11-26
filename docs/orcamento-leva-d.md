# Orçamento, leva D — impressão do orçamento

Anotações do Zé: (1) duas opções por orçamento na hora de imprimir/enviar — **"Mostrar materiais ao cliente"** e
**"Mostrar valores dos produtos/materiais"** —, com padrão da empresa em Configurações, iguais no link, no PDF e na
impressão; (2) o número da OS no PDF vira **link público** para o cliente (sem login: nunca URL interna); (3) custo
nunca aparece; multiempresa.

> 🔵 **Banco — APLICADO na produção (Neon) pelo Zé** e conferido: `prisma/sql/2027-01-27_orcamento_opcoes_documento.sql`
> (4 colunas boolean `NOT NULL DEFAULT false`, aditivo e idempotente).

## Levantamento — o que existia

| Peça | Como era |
|---|---|
| Documento do cliente | Um componente só (`OrcamentoDocumento`) para o link (`/orcamento/<token>`), a impressão (`/orcamento/<token>/imprimir`) e a versão interna. **O PDF é a impressão do navegador** dessa página (não há gerador de PDF no servidor para o orçamento). |
| Materiais do serviço | Gravados em `orcamento_materiais` (descrição, quantidade, **preço de venda** e **custo**). A consulta do documento **não os lia**: o cliente via só a linha do serviço. |
| Opções do documento | Nenhuma. Os padrões do orçamento novo (validade, garantias, não incluso, normas) são colunas de `configuracoes`, copiadas no POST do orçamento. |
| Número da OS no documento | Texto (leva A), só OS da mesma empresa. |
| Link público da OS | **A OS não tem token próprio.** O que o cliente recebe da OS é a **"Versão do cliente"**: o relatório **GERAL** (`relatorios_os`, `/relatorio/os/<token>`), criado sozinho quando a OS é concluída — é o mesmo link que a tela da OS mostra como "Link público que o cliente recebe" e o que o portal lista. Também existe o aceite (`/relatorio/aceite/<token>`), mas ele é a tela de aceitar o serviço, não a OS. |

## O que mudou

- **Tela do orçamento** (logo abaixo de Enviar / WhatsApp / Copiar link / Gerar PDF): bloco **"Documento do cliente"** com dois switches.
  - *Mostrar materiais ao cliente*: dentro de cada serviço, recuado, **"Materiais inclusos"** com descrição e quantidade.
  - *Mostrar valores dos produtos/materiais*: o **preço de venda** de cada material (unitário e total). Travado enquanto o primeiro está desligado; desligar materiais desliga valores.
  - Grava na hora (toast) e o documento da tela recarrega. Quem não edita orçamento vê travado com o motivo.
- **Os três iguais**: link, impressão/PDF e a versão interna usam as mesmas opções e a mesma regra (`lib/orcamentos/documento-opcoes.ts`).
- **Padrão da empresa**: Configurações › Orçamentos › **"Documento do cliente"** (os mesmos dois switches). Cada orçamento **novo** nasce com ele; mudar o padrão não mexe nos que existem. Padrão de fábrica: **desligado** (o cliente vê só o serviço, como hoje).
- **Custo nunca**: a consulta do documento lê o material **campo a campo, sem o custo**; o material do documento é montado sem ele; o preço só sai com a opção. Testado no HTML do servidor e no texto do PDF real.
- **OS como link**: no cabeçalho do documento, o número da OS vira link para a **versão do cliente da OS** (relatório GERAL, mesma empresa). Sem ela (OS ainda não concluída), o número fica só texto. No PDF o link sai **clicável e absoluto** (o navegador completa o endereço). Nunca `/ordens/...`.
- **Multiempresa**: rota só da empresa da sessão (outra = 404); OS e relatório de outra empresa não aparecem; o padrão é por empresa.

## Regras

| Situação | Resultado |
|---|---|
| Materiais desligado | só a linha do serviço (como antes) |
| Materiais ligado | materiais **inclusos** no serviço, com quantidade; peça de **venda à parte** continua só na tabela Produtos (não repete) |
| + valores | `preço/un · total`, na **mesma base de preço do serviço**: na versão do cliente com ISS, o mesmo fator do serviço (ex.: 440 → 462 ⇒ ×1,05); na versão interna (ISS em linha própria), o preço cadastrado. A soma exibida é exatamente Σ preço × qtd × fator (repartida sem perder centavo) |
| Valores sem materiais | ignorado (servidor, tela e documento) |
| Orçamento aprovado, convertido ou cancelado | opções travadas (409) — o documento fica como o cliente aprovou |
| Permissão | Orçamentos › editar |

## Decisões tomadas

1. Opções na **tela do orçamento** (junto do enviar/PDF), não no Editar: o Editar só existe em rascunho, e a escolha é "na hora de imprimir/enviar".
2. Só materiais **inclusos** dentro do serviço; os de venda à parte já são linhas cobradas em Produtos.
3. **ISS (resposta do Zé)**: na versão do cliente, o material leva o **mesmo fator do serviço** (valor do serviço no documento ÷ valor gravado), para o cliente ver preços coerentes entre si. O total do orçamento não muda.
4. Link da OS = **relatório GERAL** existente (reuso, sem banco novo). Sem ele, texto.
5. **Travado depois de aprovado/convertido/cancelado (confirmado pelo Zé)**: o documento fica como o cliente aprovou; a reimpressão sai igual.

## Possível leva futura

- **Link da OS antes de concluída** (o Zé decidiu: não agora). Hoje o número fica em texto até a OS ter a versão do cliente. O mínimo seria um token público na própria OS (1 coluna, 🔵) e uma página pública enxuta (status, datas, serviços).

## Testes

- `orcamento-leva-d.test.ts` (puros): opções, materiais (inclusos, ordem, preço, custo nunca), ISS (fator do serviço, soma exibida exata, centavo que sobra), link da OS (escopo GERAL, multiempresa, token inválido, nunca interno), travas.
- `orcamento-leva-d-pg.test.ts` (PostgreSQL real): o SQL 3× (aditivo, idempotente, igual ao Prisma); a **página de impressão renderizada no servidor** (padrão, materiais, valores, ISS 5% com a soma exibida batendo, sem custo, OS com/sem link, outra empresa fora); rota (401/403/400/404/409); padrão da empresa copiado no orçamento novo.
- `orcamento-leva-d-ui.test.ts` (DOM real): switches da tela e de Configurações, documento (materiais dentro da linha do serviço, valores, versão interna igual, OS link).
- **PDF real** (Playwright `page.pdf` + `pdftotext` + anotações com pdf-lib): sem/com materiais, com valores, sem custo, link clicável `http(s)://…/relatorio/os/<token>`.
- Ajustes intencionais em testes antigos: a trava da leva B "o documento não lê materiais nem custo" passou a "nunca lê custo" (agora lê materiais, sem custo); a tela de Configurações manda os dois padrões novos no PUT; uma asserção da leva B que às vezes batia num id aleatório (`/45/`) passou a olhar só o número solto.
