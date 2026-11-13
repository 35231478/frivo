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
| `app/(publico)/(marketing)/page.tsx` | A página: as 10 seções na ordem do briefing + SEO |
| `components/marketing/print.tsx` | Print do sistema e foto (imagem real ou espaço reservado) e as molduras (notebook, celular, janela) |
| `components/marketing/botao-teste.tsx` | O CTA primário (um só, repetido) |
| `components/marketing/cabecalho.tsx`, `rodape.tsx` | Cabeçalho fixo com o botão; rodapé |
| `app/(publico)/(marketing)/opengraph-image.tsx` | Imagem de compartilhamento (Open Graph), gerada no build |
| `app/(publico)/(institucional)/teste-gratis/page.tsx` | Destino **provisório** do CTA |
| `public/marketing/prints/` | Pasta dos prints e da foto reais (ver o `LEIA-ME.md` dela) |

Seções: hero · a dor · módulos (8 blocos em zigue-zague, PMOC em destaque) · por que Frivo · por que o Frivo
existe · como funciona · prova social · planos · FAQ · CTA final · rodapé.

**Por que o Frivo existe.** A origem do sistema (nasceu dentro da Termofrio Engenharia e Clima): texto, uma
foto real ao lado e o depoimento do fundador em destaque. O depoimento é do próprio fundador — fica nesta
seção (`ORIGEM`), não na prova social, que continua reservada a clientes.

## Trocar os prints

Os 10 prints da lista são **espaços reservados nomeados**. Para trocar, coloque o arquivo com o nome certo em
`public/marketing/prints/` (nomes, tamanhos e onde cada um aparece no `LEIA-ME.md` da pasta). A página troca
sozinha, sem mexer em código.

## Trocar a foto

A foto da seção "Por que o Frivo existe" segue o mesmo esquema: o arquivo `foto-equipe` (`.jpg`, `.png`,
`.webp` ou `.avif`) em `public/marketing/prints/` troca o espaço reservado.

## O que ainda é placeholder

| O quê | Onde trocar |
|---|---|
| Os 10 prints | `public/marketing/prints/` |
| A foto da equipe / campo | `public/marketing/prints/foto-equipe` |
| Prova social (depoimentos, números, logos) | `PROVA_SOCIAL` em `conteudo.ts` — nasce vazia; só entra dado real |
| Destino do CTA | `LINK_TESTE_GRATIS` em `conteudo.ts` |
| Indexação nos buscadores | `PUBLICADA` em `conteudo.ts` (`false` = `noindex`) |

**Contato.** WhatsApp e e-mail do rodapé e da página do teste grátis vêm de `CONTATO` em `conteudo.ts`; o
link do WhatsApp (`wa.me`) é montado a partir do número.

**Destino do CTA.** O Frivo ainda não tem o cadastro automático da empresa. Todos os botões apontam para
`/teste-gratis`, uma página provisória que encaminha para o contato. Quando o cadastro existir, troca-se
`LINK_TESTE_GRATIS` (ou a página vira o formulário).

**Publicação.** Enquanto houver espaço reservado, a página sai com `noindex`. No lançamento: `PUBLICADA = true`.

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

`tests/unit/marketing-home.test.ts`: seções e módulos na ordem, um CTA com um destino só, os 10 espaços
reservados nomeados (e a troca pela imagem), a seção da origem (texto, depoimento do fundador, espaço da
foto), prova social vazia e sem número inventado, FAQ, rodapé com o contato, SEO, e o
acesso pelo middleware real (anônimo abre a home; liberar a `/` não libera o sistema; logado vai ao painel).

## Prints

`docs/prints/marketing-home/`: hero e página inteira no computador e no celular, a imagem de compartilhamento,
a página provisória do teste grátis, a seção "Por que o Frivo existe" e o rodapé com o contato.
