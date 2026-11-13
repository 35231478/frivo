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

## Prints do sistema

Cada lugar de print tem um **nome** (`PRINTS`, em `conteudo.ts`). Se o arquivo com esse nome está em
`public/marketing/prints/`, entra a imagem real; se não, fica o espaço reservado nomeado. Colocar o arquivo
na pasta troca o espaço sozinho, sem mexer em código. A tabela completa (nome, onde aparece, situação) está
no `LEIA-ME.md` da pasta.

| # | Tela | Onde aparece |
|---|---|---|
| 01 | Dashboard | Hero (notebook) |
| 02 | Calendário de OS | Ordens de serviço |
| 03 | Orçamento com aprovação | Financeiro — print principal, **em destaque** |
| 04, 05, 10 | Orçamentos, Contratos, Financeiro | Financeiro — miniaturas com legenda |
| 06 | Estoque | Estoque, compras e materiais |
| 07 | Mapa dos técnicos | Mapa da equipe — **em destaque** |
| 08, 09 | Equipes, Colaboradores | Desempenho da equipe (um abaixo do outro) |
| 11 a 14 | App do técnico, PMOC, Aceite, Equipamento + QR | Seguem como espaço reservado (telas não enviadas) |

"Em destaque" = o print ocupa a coluna larga do bloco (`printEmDestaque`). Um recorte fora de 16:10 declara a
`proporcao` no print, e a moldura segue a imagem.

**Tratamento das telas reais.** Entram só com a área da tela: sem a barra lateral e sem a barra do topo, que
mostra o e-mail do usuário. O 09 saiu sem a coluna Contato (telefone e e-mail do colaborador) e o 07 teve a
coordenada do técnico borrada. Nomes de clientes, de colaboradores e valores que aparecem nas telas ficam
visíveis — conferir antes de publicar.

## Trocar a foto

A foto da seção "Por que o Frivo existe" segue o mesmo esquema: o arquivo `foto-equipe` (`.jpg`, `.png`,
`.webp` ou `.avif`) em `public/marketing/prints/` troca o espaço reservado.

## O que ainda é placeholder

| O quê | Onde trocar |
|---|---|
| Os prints que faltam (01 a 05 em arquivo; 11 a 14 por enviar) | `public/marketing/prints/` |
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

`tests/unit/marketing-home.test.ts`: seções e módulos na ordem, um CTA com um destino só, cada print no bloco
certo (imagem real ou espaço reservado nomeado; 03 e 07 em destaque), a seção da origem (texto, depoimento do fundador, espaço da
foto), prova social vazia e sem número inventado, FAQ, rodapé com o contato, SEO, e o
acesso pelo middleware real (anônimo abre a home; liberar a `/` não libera o sistema; logado vai ao painel).

## Prints

`docs/prints/marketing-home/`: hero e página inteira no computador e no celular, a imagem de compartilhamento,
a página provisória do teste grátis, a seção "Por que o Frivo existe", o rodapé com o contato e os blocos
que já têm tela real.
