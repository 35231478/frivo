# Prints da home de vendas

Telas do Frivo com a **empresa de demonstração** ("Polar Climatização"): clientes, pessoas, endereços,
documentos e valores são inventados. Nada aqui vem da produção — o repositório e a página são públicos.

## Regenerar

```bash
npm run prints:vendas
```

O comando cria a empresa de demonstração num banco **local** (`scripts/vendas/seed-demo.ts`), sobe o app
(ou usa o que estiver em `PRINTS_URL`), entra como a gestora e como o técnico e grava cada tela aqui, em
WebP. Rode de novo sempre que a interface mudar. Detalhes e pré-requisitos em `docs/marketing-home.md`.

## Arquivos

| Arquivo | Tela | Formato | Onde aparece |
|---|---|---|---|
| `01-dashboard` | Dashboard | computador | Hero (notebook) e página do teste grátis |
| `02-calendario-os` | Calendário de OS | computador | Ordens de serviço (abaixo da OS) |
| `03-orcamento-aprovado` | Orçamento aprovado pelo link | computador | Financeiro — print principal, em destaque |
| `04-orcamentos` | Lista de orçamentos | computador | Financeiro — miniatura |
| `05-contratos` | Contratos | computador | Financeiro — miniatura |
| `06-estoque-saldos` | Estoque | computador | Estoque, compras e materiais |
| `07-mapa-equipe` | Mapa da equipe | computador | Mapa da equipe — em destaque |
| `08-desempenho` | Desempenho (ranking) | computador | Desempenho da equipe |
| `08-desempenho-tv` | Desempenho no modo TV | computador | Desempenho da equipe — miniatura |
| `09-equipes` | Colaboradores | computador | Desempenho da equipe — miniatura |
| `10-financeiro-painel` | Dashboard financeiro | computador | Financeiro — miniatura |
| `11-app-tecnico` | App do técnico (Meu dia) | celular | Hero e Ordens de serviço |
| `12-pmoc` | PMOC — cronograma | computador | PMOC automático |
| `13-aceite` | Aceite do cliente pelo link (estrelas) | celular | Aceite e avaliação |
| `14-equipamento-qr` | Ficha do equipamento | computador | Equipamentos com QR |
| `14-qr-celular` | O que abre ao ler o QR | celular | Equipamentos com QR |
| `15-os-atividades` | OS com o painel de Atividades | computador | Ordens de serviço — em destaque |
| `foto-equipe` | Foto real da equipe (opcional) | foto | "Por que o Frivo existe"; sem ela, a seção fica só com o texto |

Os arquivos que já existiram com telas da produção (`06-estoque`, `07-mapa-tecnicos`, `08-equipes`,
`09-colaboradores`, `10-financeiro`) não voltam com o mesmo nome: um cache de imagem otimizada poderia
servir a versão antiga nesse endereço.

Computador: 1600 × 1000 (16:10). Celular: 780 × 1646 (9:19). Os nomes são os de
`components/marketing/conteudo.ts`; o teste da página falha se algum faltar.
