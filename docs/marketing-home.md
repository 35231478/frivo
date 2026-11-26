# Home de vendas (página 1)

A página de vendas do Frivo, com um objetivo só: levar ao **teste grátis de 7 dias, sem cartão**.

## Onde mora

No próprio app, na rota **`/`** (`app/(publico)/(marketing)/page.tsx`).

- **Visitante sem login** vê a home de vendas. Antes, a `/` mandava para o login.
- **Quem está logado** não vê a página: o middleware leva direto ao painel (ou ao "Meu dia", no modo técnico).
- O botão **Entrar** do cabeçalho leva ao login.
- O link "Início" das páginas institucionais (FAQ, Privacidade, Termos) passa a cair aqui.

Fica no app porque a marca (tokens, fontes, logo), as páginas institucionais e o deploy já estão aqui: é uma
página a mais, sem outro projeto para manter. Para servir em `frivo.com.br`, o domínio é apontado para o
mesmo projeto e define-se `NEXT_PUBLIC_SITE_URL` (base do canonical e da imagem de compartilhamento).

## Estrutura

| Arquivo | Papel |
|---|---|
| `components/marketing/conteudo.ts` | **Todo o conteúdo**: textos do briefing, lista dos prints, FAQ, links, contato e o destino do CTA |
| `app/(publico)/(marketing)/page.tsx` | A página: as seções na ordem do briefing + SEO |
| `components/marketing/print.tsx` | Prints e foto, nas molduras (notebook, celular, janela, miniatura) |
| `components/marketing/botao-teste.tsx` | O CTA primário (um só, repetido) |
| `components/marketing/cabecalho.tsx`, `rodape.tsx` | Cabeçalho fixo com o botão; rodapé |
| `app/(publico)/(marketing)/opengraph-image.tsx` | Imagem de compartilhamento (Open Graph), gerada no build |
| `app/(publico)/(institucional)/teste-gratis/page.tsx` | Destino **provisório** do CTA |
| `public/marketing/prints/` | Os prints (ver o `LEIA-ME.md` dela) |
| `scripts/vendas/` | A empresa de demonstração e o gerador dos prints (`npm run prints:vendas`) |

Seções: hero · a dor · módulos (8 blocos em zigue-zague, PMOC em destaque) · por que Frivo · por que o Frivo
existe · como funciona · prova social (só com dado real) · planos · FAQ · CTA final · rodapé.

**Por que o Frivo existe.** A origem do sistema (nasceu dentro da Termofrio Engenharia e Clima) e o depoimento
do fundador em destaque. A foto real da equipe entra ao lado do texto quando existir
`public/marketing/prints/foto-equipe.(jpg|png|webp|avif)`; sem ela, o texto ocupa a linha.

**Nada de espaço reservado no ar.** Print sem arquivo não aparece (e o teste falha); a prova social e a foto
só aparecem com conteúdo real; o WhatsApp só com número configurado.

## Prints: empresa de demonstração

Os prints são telas reais do sistema, tiradas de uma **empresa fictícia** — nunca da produção (o repositório e
a página são públicos). Um comando refaz todos, sempre que a interface mudar:

```bash
DATABASE_URL="postgresql://…@localhost:5432/frivo_prints" npm run prints:vendas
```

1. **Seed** (`scripts/vendas/seed-demo.ts`): cria a "Polar Climatização" com um mês de operação — 8 clientes
   (clínica, condomínio, colégio, empório, edifício corporativo, hotel, loja, academia), 6 técnicos em 3
   equipes, ~50 equipamentos (split, cassete, piso-teto, VRF, chiller, câmara fria) com QR, ~120 OS
   (preventiva, corretiva, instalação, limpeza química) com checklist, fotos e aceite com nota, PMOC com
   cronograma gerado pelo próprio sistema, orçamentos, contratos, estoque, 6 meses de financeiro,
   Desempenho e a posição dos técnicos no mapa. As datas são relativas a hoje. Documentos com dígito
   verificador inválido de propósito, e-mails `.exemplo`, imagens geradas na hora.
2. **Trava**: seed e gerador só rodam com `DATABASE_URL` em `localhost` (`scripts/vendas/banco-local.ts`).
3. **Prints** (`scripts/vendas/gerar-prints.mjs`): sobe `next dev` (ou usa `PRINTS_URL`), entra como a
   gestora e como o técnico, e fotografa cada tela em 2x sem a barra lateral e sem a barra do topo. Grava
   WebP: computador 1600 × 1000, celular 780 × 1646. `PRINTS_SO=07-mapa-equipe,12-pmoc` refaz só esses.

Pré-requisitos: um Postgres local com o schema (`npx prisma db push`), o Chromium do Playwright e acesso aos
blocos do OpenStreetMap (o print do mapa).

| Tela | Onde aparece |
|---|---|
| 01 Dashboard + 11 app do técnico | Hero (notebook + celular) |
| 15 OS com o painel de Atividades + 11 app do técnico + 02 calendário | Ordens de serviço — **em destaque** |
| 12 PMOC (cronograma) | PMOC automático (bloco de destaque) |
| 13 Aceite pelo link (estrelas) | Aceite e avaliação |
| 08 Desempenho + 08 modo TV + 09 colaboradores | Desempenho da equipe |
| 14 ficha do equipamento + 14 leitura do QR no celular | Equipamentos com QR |
| 06 Estoque | Estoque, compras e materiais |
| 03 Orçamento aprovado + 04 orçamentos, 05 contratos, 10 financeiro | Financeiro — **em destaque** |
| 07 Mapa | Mapa da equipe — **em destaque** |

## Configuração

| O quê | Onde |
|---|---|
| WhatsApp de vendas | variável de ambiente `WHATSAPP_VENDAS` (com DDD, ex.: `62912345678`); sem ela, o WhatsApp não aparece. A home é estática: a variável vale a partir do **próximo build/deploy** |
| E-mail de contato | `contatoDeVendas` em `conteudo.ts` |
| Prova social (depoimentos, números, logos) | `PROVA_SOCIAL` em `conteudo.ts` — só dado real |
| Destino do CTA | `LINK_TESTE_GRATIS` em `conteudo.ts` |
| Indexação nos buscadores | `PUBLICADA` em `conteudo.ts` (`false` = `noindex`) |

O contato vale para o rodapé da home, para a página do teste grátis e para o rodapé das páginas institucionais.

**Destino do CTA.** O Frivo ainda não tem o cadastro automático da empresa. Todos os botões apontam para
`/teste-gratis`, uma página provisória: os três passos do teste e o pedido de acesso pelo WhatsApp (com a
mensagem pronta) ou por e-mail. Quando o cadastro existir, troca-se `LINK_TESTE_GRATIS` (ou a página vira o
formulário).

## Desempenho

- Página **estática** (sem sessão nem banco): HTML pronto, servido do cache.
- Sem JavaScript próprio: o FAQ é `<details>` nativo e o cabeçalho fixo é CSS.
- Prints via `next/image`: tamanho por tela, WebP/AVIF, sob demanda; só os do hero têm prioridade.
- Fontes da marca (Inter e Archivo) já vêm do layout raiz, com `display: swap`.

## Design

Tokens do sistema (`lib/ui/tokens.ts`): base neutra, acento petróleo, sem degradê e sem emoji; ícones do
lucide. A copy é a do briefing, em 2ª pessoa — por isso `app/(publico)/(marketing)` e `components/marketing`
ficam fora do ratchet de tom, como as páginas institucionais.

## Testes

`tests/unit/marketing-home.test.ts`: seções e módulos na ordem, um CTA com um destino só, cada print no bloco
certo e com o arquivo presente (03, 07 e 15 em destaque), nenhum espaço reservado na página, prova social e foto
fora quando vazias, WhatsApp só com número configurado, FAQ, rodapé, SEO, a trava de banco local dos scripts e o
acesso pelo middleware real (anônimo abre a home; liberar a `/` não libera o sistema; logado vai ao painel).

## Prints da página

`docs/prints/marketing-home/`: a página antes e depois desta troca de prints, no computador e no celular, e a
página do teste grátis.
