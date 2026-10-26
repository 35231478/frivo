# Diagnóstico de performance — "clico e demora"

Data: 26/10/2026 · Base: `master` (bd09b94) · **Só medição — nada foi corrigido.**

## Resumo em uma frase

O tempo não está no banco nem no navegador. Está na **distância entre o servidor (Vercel) e o banco
(Neon)**, multiplicada pelo **número de consultas feitas uma depois da outra** em cada tela. Cada
consulta leva menos de 0,2 ms no Postgres. O que custa é a ida e volta pela rede, que se repete de
5 a 47 vezes por tela.

## Como foi medido

- Build de produção (`next start`) com o banco de demonstração, a mesma build que está na `master`.
- **Consultas por tela:** log de todas as instruções do Postgres (`log_min_duration_statement = 0`).
  Cada tela foi pedida com **uma** requisição (curl com o cookie de sessão), para não misturar
  prefetch nem service worker.
- **Efeito da distância:** um proxy TCP entre o Next e o Postgres atrasa cada pacote. Mediu-se a
  mesma build em dois cenários:
  - **"perto"**: 2 ms de ida e volta. É o caso de Vercel `gru1` (São Paulo) com Neon `sa-east-1`.
  - **"longe"**: 120 ms de ida e volta. É o caso de Vercel `iad1` (Washington, o padrão da Vercel)
    com Neon `sa-east-1`. O valor usado é a latência típica entre us-east-1 e sa-east-1.
- **Navegador:** Chromium com cliques reais no menu, contando cada requisição feita ao servidor.

## Onde está o tempo (medido)

Tempo para o servidor entregar a tela inteira, por requisição já com o servidor "quente":

| Tela | Consultas SQL | Banco perto (2 ms) | Banco longe (120 ms) |
|---|---:|---:|---:|
| Central da OS (`/ordens/[id]`) | 25 | 0,15 s | **3,12 s** |
| Financeiro (dashboard) | 29 | 0,16 s | **3,01 s** |
| Lista de OS | 16 | 0,15 s | **2,55 s** |
| Perfil do equipamento | 29 | 0,18 s | **2,54 s** |
| Colaboradores | 20 | 0,13 s | **2,28 s** |
| Contas a pagar | 18 | 0,16 s | **2,16 s** |
| Equipamentos (lista) | 19 | 0,57 s | **2,05 s** |
| Dashboard | 47 | 0,18 s | **1,81 s** |
| Contas a receber | 17 | 0,14 s | 1,68 s |
| Prazos e SLA | 16 | 0,12 s | 1,64 s |
| Calendário | 17 | 0,09 s | 1,53 s |
| `/api/alertas` (sino, em todo carregamento) | 22 | 0,07 s | 1,38 s |
| Contratos | 13 | 0,19 s | 1,27 s |
| Ficha do cliente | 11 | 0,14 s | 1,20 s |
| Clientes (lista) | 7 | 0,17 s | 0,79 s |
| Configurações | 5 | 0,06 s | 0,54 s |

Atividade no app do técnico (`/api/tecnico/atividades/[id]`): 27 consultas. Pela mesma conta, uns
3 s com o banco longe, antes de somar a rede do celular.

**Clique real no menu**, do clique até o conteúdo aparecer:

| Destino | Banco perto | Banco longe |
|---|---:|---:|
| Ordens de Serviço | 0,48–0,57 s | **2,7 s** |
| Financeiro | 0,41–0,44 s | **2,9–3,1 s** |
| Calendário | 0,43–0,55 s | **2,9 s** |
| Dashboard | 0,33–0,37 s | **1,8 s** |
| Clientes | 0,37–1,07 s | 1,2–1,3 s |

(tempo extra − tempo perto) ÷ 120 ms dá **quase o número de consultas**. Ou seja, elas rodam **em
série**, uma esperando a outra.

---

## Achados, do maior ganho para o menor

### 🔴 1. Região: servidor nos EUA, banco em São Paulo — **CONFIG (Zé)**
- **O que vi:**
  - O `vercel.json` não define região, e o código não tem `preferredRegion` em nenhuma rota. Então
    as funções rodam na região escolhida no painel. O padrão da Vercel é **`iad1` (Washington)**.
  - O Neon está em `sa-east-1` (São Paulo).
  - Daqui não deu para ler o cabeçalho `x-vercel-id`, porque a rede do ambiente bloqueia o
    `vercel.app`.
  - Para confirmar, o Zé pode abrir o DevTools em qualquer página do sistema e olhar `x-vercel-id`.
    O segundo código é a região da função, por exemplo `gru1::iad1::…`.
- **Impacto medido:**
  - Cada consulta custa cerca de 120 ms a mais, e a tela faz de 5 a 47 consultas.
  - As telas mais usadas levam de 2 a 3 s; com o banco perto, levam de 0,1 a 0,2 s (10 a 20 vezes
    mais rápido).
  - Além disso, o usuário no Brasil também atravessa até os EUA a cada clique (mais ~120 ms).
- **Correção:**
  - Vercel → *Settings → Functions → Function Region* → **São Paulo (gru1)**.
  - Em código, o equivalente é `"regions": ["gru1"]` no `vercel.json`.
  - Nenhuma linha de regra muda.
- **É o maior ganho isolado do relatório.**
- **Status:** `"regions": ["gru1"]` foi adicionado ao `vercel.json`. Validar depois do deploy pelo
  cabeçalho `x-vercel-id`, que deve trazer `gru1` como região da função.

### 🔴 2. Cada `include` do Prisma vira uma consulta em série — **CÓDIGO**
- **O que vi:**
  - O Prisma 6 sem `relationJoins` busca cada relação (cliente → unidade → atividades → técnicos →
    …) numa consulta separada, uma depois da outra.
  - A central da OS faz **25 consultas** para uma tela; a lista de OS, 16; o calendário, 17; a
    atividade do técnico, 27.
- **Experimento local** (ligar `previewFeatures = ["relationJoins"]` no `schema.prisma`, rebuildar e
  medir com o banco a 120 ms; depois desfeito):

  | Tela | Antes | Com `relationJoins` |
  |---|---|---|
  | Central da OS | 25 consultas, 3,12 s | **5 consultas, 0,56 s** |
  | Lista de OS | 16 consultas, 2,55 s | **8 consultas, 0,72 s** |
  | Calendário | 17 consultas, 1,53 s | **7 consultas, 0,45 s** |
  | Perfil do equipamento | 29 consultas, 2,54 s | **13 consultas, 1,16 s** |
  | Colaboradores | 20 consultas, 2,28 s | **15 consultas, 1,17 s** |

- **Correção:**
  - Uma linha no `schema.prisma` (`previewFeatures = ["relationJoins"]`). No PostgreSQL, o padrão
    passa a ser um JOIN só.
  - Antes, rodar a suíte completa: muda o SQL de todos os `include`.
  - Vale mesmo depois do item 1: menos idas ao banco e menos conexões abertas.

### 🟠 3. Cada clique renderiza a tela 3 vezes (service worker) — **CÓDIGO**
- **O que vi:**
  - Num clique no menu, o navegador faz a navegação RSC e, em seguida, **mais dois GET do HTML
    completo da mesma tela**.
  - Isso vem do PWA (`cacheOnFrontEndNav` + `aggressiveFrontEndNavCaching` em `next.config.ts`),
    que baixa a página de novo para guardá-la em cache.
  - Medido: clique em Clientes = 20 consultas (3 × 7); clique em Ordens = 47 (3 × 16).
- **Impacto:**
  - O usuário espera só a primeira renderização, mas as outras duas disputam a mesma função, as
    mesmas conexões do banco e a mesma banda.
  - No celular, isso significa baixar de 100 a 470 KB de HTML a mais **a cada clique**.
  - Também acorda mais instâncias na Vercel, com mais partidas a frio.
- **Correção:**
  - Tirar `cacheOnFrontEndNav`/`aggressiveFrontEndNavCaching`, ou restringir ao `/tecnico`, que é a
    única página que precisa abrir offline.
  - A página `/offline` continua como fallback.

### 🟠 4. Telas que gravam no banco ao serem abertas + laços em série — **CÓDIGO**
- **O que vi:**
  - **Financeiro:**
    - antes de ler, roda 2 `updateMany` para marcar contas vencidas. Cada um vira
      BEGIN/UPDATE/COMMIT, ou seja, 3 idas ao banco;
    - depois monta o gráfico de 6 meses **num laço, um mês por vez** (6 rodadas em série);
    - ainda faz uma contagem solta no fim.
    - Resultado: 29 consultas e 3,0 s. **Quase não melhora com `relationJoins`** (2,5 s).
  - **Prazos, dashboard e `/api/alertas`:** os mesmos `updateMany` em `os_prazos`/`os_prazo_etapas`
    a cada abertura (e o sino repete a cada 2 min).
- **Correção:**
  - Marcar "vencido" num **cron diário** (o `vercel.json` já tem cron), ou calcular o status na
    leitura sem gravar.
  - Fazer os 6 meses numa consulta agrupada por mês.
  - Colocar o restante num `Promise.all`.
- **Ganho estimado:** financeiro de cerca de 3 s para menos de 0,5 s com o banco longe; uns 0,1 s
  com o banco perto.

### 🟠 5. Sessão: 3 consultas em série antes de qualquer dado — **CÓDIGO**
- **O que vi:**
  - Toda requisição (página, API, foto) confere usuário e empresa no banco, em 2 consultas.
  - O layout ainda faz uma terceira consulta só para o avatar.
  - São três idas em série antes de a tela começar a buscar os próprios dados: cerca de 360 ms com
    o banco longe.
- **Correção:**
  - Uma consulta só (usuário + empresa + avatar). Com `relationJoins` já vira uma.
  - Avatar servido por URL (`/api/usuarios/[id]/avatar`, com cache) em vez de base64 no layout
    (ver item 7).

### 🟡 6. Banco dormindo e partida a frio — **CONFIG (Zé)** + medição
- **Partida a frio da função** (primeiro acesso de uma instância nova, medido aqui):

  | Cenário | 1º acesso a `/configuracoes` | Acessos seguintes |
  |---|---:|---:|
  | Banco perto | 3,7–3,8 s | 0,06–0,12 s |
  | Banco longe | **4,8–5,4 s** | até ~1,1 s enquanto o pool abre conexões |

  Cada conexão nova ao Neon exige TCP + TLS + autenticação: cerca de 4 idas e voltas (~0,5 s com o
  banco longe).
- **Neon dormindo:**
  - No plano Free do Neon, o compute **suspende após 5 min sem uso** (scale-to-zero). O primeiro
    acesso depois disso espera o compute acordar: de algumas centenas de ms a 1–2 s.
  - Somado à partida a frio da função, é o "de manhã o primeiro clique leva 5–8 s".
  - Não dá para medir daqui sem acesso ao Neon.
- **Correção (Zé):**
  - No Neon, conferir o plano e, no branch de produção, aumentar ou desligar o *autosuspend*
    (*Compute → Edit → Scale to zero*; no Free não dá para desligar).
  - Conferir se o `DATABASE_URL` da Vercel usa o host **`-pooler`** (pooled).
  - Na Vercel, ligar o **Fluid Compute**, que reaproveita instâncias e reduz partidas a frio.

### 🟡 7. Payload: base64 repetido e listas pesadas — **CÓDIGO**
- **Avatar:**
  - Vai em base64 para 3 componentes (cabeçalho, menu lateral e menu do celular) e aparece **6
    vezes** por página (no HTML e de novo no payload RSC).
  - Medido com um avatar de 3,8 KB: +23 KB por página.
  - Com uma foto real de 256 px (15–25 KB), são **+90 a 150 KB em todo carregamento de página**.
- **Relatório público da OS:**
  - 315 KB, com as 17 imagens em base64 **duas vezes** (148 KB no HTML + 167 KB no RSC).
  - Cresce com o número de fotos; uma OS com 30 fotos passa de 2 MB.
- **Fotos do atendimento:**
  - `/api/fotos-atendimento/[id]` responde com `Cache-Control: private, no-store`, então a mesma
    foto (~78 KB) é baixada de novo a cada visita.
  - Cada download ainda faz as 3 consultas de sessão.
  - Uma foto nunca muda: `private, max-age=31536000, immutable` resolve.
- **Listas:**
  - `/clientes` = 455 KB e `/estoque` = 461 KB de HTML (78–89 KB com gzip).
  - Motivo: a página traz a tabela (desktop) **e** os cartões (celular) renderizados e serializados
    no RSC.
  - Aceitável hoje com gzip, mas é o dobro do necessário.
  - Correção: renderizar um dos dois conforme a tela, ou extrair o markup repetido.

### 🟢 8. Índices que faltam (pesam com o crescimento) — **CÓDIGO (SQL aditivo 🔵)**
- **Hoje:** com os dados atuais, toda consulta leva menos de 0,2 ms; não é gargalo agora.
- **Sem índice, varrem a tabela inteira à medida que ela cresce:**
  - `medicao_itens(ordem_servico_id)` e `orcamento_ordens_servico(ordem_servico_id)`, consultados em
    **toda** abertura de OS;
  - `medicao_itens(medicao_id)` (detalhe da medição);
  - `veiculo_documentos(veiculo_id)` (o sino de alertas);
  - `produtos(empresa_id)` (lista do estoque).
- **Já cobertos:** as tabelas principais (OS, atividades, contas a receber e a pagar, clientes,
  equipamentos, movimentações do estoque) já têm índice por empresa e status/data.

### 🟢 9. Prefetch, cache e front — **CÓDIGO (baixo ganho)**
- **Prefetch:**
  - Cada lista pré-carrega todos os links visíveis: 12 a 14 requisições ao abrir Clientes ou OS.
  - Custam pouco no banco, mas cada uma é uma chamada de função na Vercel.
  - Correção: `prefetch={false}` nos links das linhas.
- **Cache de cadastros quase fixos:**
  - Tipos de OS, técnicos, cargos e tabelas de preço são relidos em toda tela.
  - Poderiam ter cache por empresa de 30 a 60 s, com `revalidateTag` ao salvar.
- **`/api/alertas`:** 22 consultas e 2 gravações a cada carregamento de página e a cada 2 min.
  Poderia ter cache por empresa de 60 s e as gravações saírem para o cron (item 4).
- **JavaScript e imagens:**
  - **JavaScript sem problema:** 105 KB compartilhados (gzip) e de 135 a 224 KB por tela. As fontes
    são locais (`next/font`) e o mapa é carregado sob demanda.
  - **Imagens:** os ícones do PWA são pequenos e não há imagem grande fora as fotos (item 7).
  - **Não é aqui que está a lentidão.**

---

## As 5 correções que mais deixariam o sistema rápido

| # | Correção | Quem | Ganho esperado |
|---|---|---|---|
| 1 | **Função na região São Paulo (`gru1`)** | Zé (config Vercel) ou 1 linha no `vercel.json` | Telas de 2–3 s → 0,1–0,3 s. É o maior ganho. |
| 2 | **`relationJoins` no Prisma** (cada `include` deixa de ser uma consulta em série) | Código (1 linha + suíte) | OS de 25 para 5 consultas; menos conexões e menos tempo em qualquer região. |
| 3 | **Desligar o re-download da página pelo service worker** (`cacheOnFrontEndNav`) | Código (`next.config.ts`) | Cada clique para de renderizar a tela 3 vezes; menos dados no celular. |
| 4 | **Tirar as gravações de "vencido" das telas** (cron) e montar o financeiro numa consulta agrupada | Código | Financeiro, prazos, dashboard e sino sem gravar a cada abertura; financeiro de ~3 s para menos de 0,5 s. |
| 5 | **Neon sem dormir em produção + URL pooled + Fluid Compute** | Zé (config Neon/Vercel) | Fim do "primeiro clique do dia" de 5–8 s. |

Logo depois deles: sessão numa consulta só e avatar por URL (item 5), cache imutável nas fotos e
relatório público sem base64 duplicado (item 7).

**Ordem sugerida:**
1. Itens 1 e 5 primeiro: são só configuração e não mexem em código.
2. Medir de novo com o `x-vercel-id` confirmando `gru1`.
3. Depois os itens 2, 3 e 4, cada um num PR, com a suíte completa.
