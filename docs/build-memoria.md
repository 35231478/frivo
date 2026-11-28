# Build sem estourar a memória da Vercel

**Problema (deploy de produção do #288):** o `npm run build` na Vercel morreu com `SIGKILL` e
"Out of Memory (OOM) event", na etapa "Linting and checking validity of types". A produção ficou no #286. O CI
estava verde: o runner do GitHub tem 16 GB, a máquina padrão de build da Vercel tem 8 GB.

**Causa:** o `NODE_OPTIONS=--max-old-space-size=6144` do script de build deixava cada processo do Node crescer até
6 GB de heap. Na etapa de tipos, o processo do webpack (cerca de 1,5 GB) ficava vivo ao lado do processo da checagem
de tipos (4,4 GB). Somando o resto do container da Vercel, os 8 GB acabavam. A prévia passava por margem.

## O que mudou

1. **Na Vercel, o `next build` não checa tipos nem lint** (`next.config.ts`: `typescript.ignoreBuildErrors` e
   `eslint.ignoreDuringBuilds` valem só quando `VERCEL` está definido).
   - Quem garante os tipos é o job **Typecheck** do CI (`tsc --noEmit`), que é portão obrigatório do PR.
   - No CI e local o `next build` continua checando.
   - Hoje o projeto não tem configuração de ESLint, então o lint do `next build` não verificava nada.
2. **`experimental.webpackBuildWorker: true`:** compila num processo à parte, que termina antes da coleta e da
   geração das páginas e devolve a memória.
   - O Next liga isso sozinho só quando não há `webpack` próprio, e o next-pwa tem o dele. Por isso estava desligado.
   - **Foi o maior ganho.**
3. **`experimental.webpackMemoryOptimizations: true`:** ganho pequeno, cerca de 0,1 GB a menos e uns 6 s mais rápido.
   Fica ligado por ser de graça.
4. **Heap por lugar** (`scripts/build.mjs`, chamado pelo `npm run build`):
   - na Vercel, **4096 MB**;
   - no CI e local, **6144 MB**, porque a checagem de tipos sozinha passa de 4 GB.
   - Um `--max-old-space-size` já presente no `NODE_OPTIONS` (no painel da Vercel, por exemplo) vale e não é trocado.
   - O CI deixou de fixar o heap por fora: a fonte é o script.

## Medições

- **Como medi:** build limpo (sem `.next`), máquina de 4 CPUs (as mesmas 4 da máquina padrão da Vercel).
- **O que conta:** a soma do RSS do processo do build e de **todos os filhos**, amostrada a cada 0,2 s. A soma
  conta em dobro a memória compartilhada, então é um teto pessimista.
- **Como simulei a Vercel:** com `VERCEL=1`.
- O script da medição não faz parte do PR.

| # | Cenário | Tipos e lint no build | Heap | Build worker | Mem. opt. | **Pico total (RSS)** | Onde fica o pico | Tempo |
|---|---|---|---|---|---|---|---|---|
| A | **master hoje** (o que estourou) | sim | 6144 | não | não | **5,84 GB** | checagem de tipos (4,38 GB num processo) | 245 s |
| B | Vercel sem tipos | não | 6144 | não | não | 5,27 GB | geração das páginas | 135 s |
| C | + heap 4 GB | não | 4096 | não | não | 5,01 GB | geração das páginas | 129 s |
| D | + otimização de memória | não | 4096 | não | sim | 4,92 GB | geração das páginas | 123 s |
| E | heap 3 GB | não | 3072 | não | não | 4,41 GB | geração das páginas | 134 s |
| **F** | **Vercel, escolhido** | **não** | **4096** | **sim** | **sim** | **3,96 GB** | compilação (depois cai para 0,35 GB) | 124 s |
| G | o mesmo com heap 3 GB | não | 3072 | sim | sim | 3,48 GB | compilação | 129 s |
| H | **CI e local, escolhido** | sim | 6144 | sim | sim | **4,70 GB** | checagem de tipos (4,43 GB) | 230 s |

**O que os números dizem:**
- **Pular os tipos sozinho não resolvia (B):** o processo do webpack ficava com cerca de 3,7 GB do começo ao fim,
  e a geração das páginas somava mais 1,4 GB.
- **O build worker resolve (F):** a memória da compilação é devolvida antes das páginas. Nenhuma fase passa de
  4 GB, e o pico fica 1,9 GB abaixo do de hoje.
- **Por que 4096 e não 3072:** com 3072 (G) o pico cai 0,5 GB, mas a compilação chega a 3,2 GB de RSS, encostada
  no teto do heap. Com o projeto crescendo, viraria um "heap out of memory". Com 4096 sobram cerca de 4 GB nos
  8 GB da máquina e ainda há margem no heap.
- **Workers da geração estática:** não foi preciso reduzir (`experimental.cpus`). A geração das páginas fica em
  2,6 GB.
- **CI e local (H):** o pico caiu de 5,84 para 4,70 GB, também pelo build worker. Os tipos continuam checados no
  `next build`.

**PWA igual:** comparei o build sem o worker (E) com os builds com o worker (F, G, H).
- Os mesmos arquivos em `public/`: `sw.js`, `workbox-*`, `worker-*` (o worker próprio), `swe-worker-*`, `fallback-*`.
- As mesmas 814 entradas no precache, com a mesma forma (só os hashes do build mudam).
- `/offline` continua sendo o fallback de documento, e a página `/offline` é gerada.
- Os 5 caches `frivo-*` do runtime são os mesmos.

## Plano B

Se o projeto crescer a ponto de a compilação sozinha passar de cerca de 6 GB, há duas saídas:
- **Enhanced Builds da Vercel:** máquina de build maior (mais memória e CPU). É **pago**, e a decisão é do Zé.
- **Baixar as `cpus` da geração estática:** ganho menor, porque hoje o pico está na compilação, não nas páginas.

Para acompanhar, a Vercel mostra a memória no log do build quando há OOM. Para repetir a medição local, use
`VERCEL=1 npm run build` com um amostrador de RSS da árvore de processos.
