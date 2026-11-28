# Fotos e anexos fora do banco — proposta (decisão do Zé)

**Status:** só a proposta. Nada aqui foi implementado nem contratado. A contratação, e o momento de fazer, são decisão do Zé.

**Resumo:**
- Hoje toda foto e todo anexo do Frivo mora DENTRO do PostgreSQL, como texto (data URL em base64).
- Com o chat, isso passa a crescer centenas de MB por mês, mesmo com a compressão do HOTFIX 2. Acima de ~80 fotos por dia, cresce mais de 0,5 GB por mês.
- A proposta: mover os arquivos para um armazenamento de arquivos (Vercel Blob, ou Cloudflare R2 como alternativa), deixando no banco só a referência.
- O custo estimado fica perto de zero a poucos dólares por mês. A migração é em fases reversíveis; a única fase destrutiva fica para uma decisão separada.

## 1. Quanto pesa uma foto do chat (medido)

**Como foi medido:**
- O mesmo algoritmo do aparelho (`prepararFoto`, `lib/chat/foto-cliente.ts`), com a compressão do HOTFIX 2 (#300): degraus até caber no alvo.
  - **foto:** alvo ≤ 200 KB; 1280 px a 70%, depois 1024 px a 60%, depois 800 px a 55%;
  - **miniatura:** alvo ≤ 15 KB; 256 px a 60%, depois 192 px a 50%.
- O algoritmo rodou no Chromium sobre cenas sintéticas de 12 MP (4032 × 3024, JPEG 92%, como sai do celular).
- Os dados são fictícios; não há fotos reais de clientes no repositório.

| Cena (12 MP) | Original | Foto comprimida (antes do HOTFIX 2) | **Foto comprimida agora** | **Foto no banco (texto base64)** | Miniatura no banco |
|---|---|---|---|---|---|
| Parede lisa, pouca textura | 1,9 MB | 62 KB | **19 KB** (1280/70%) | **26 KB** | 2 KB |
| Equipamento (etiquetas, cabos, peças) | 3,6 MB | 370 KB | **118 KB** (1024/60%) | **157 KB** | 17 KB |
| Aletas de condensadora (detalhe fino) | 4,4 MB | 369 KB | **189 KB** (1280/70%) | **252 KB** | 11 KB |
| Ruído puro (pior caso teórico, não é foto real) | 8,4 MB | 857 KB | **144 KB** (800/55%) | **192 KB** | 14 KB |

**Leituras:**
- **Foto típica de trabalho:** 120–190 KB comprimida; ~0,2–0,27 MB no banco com a miniatura, porque o base64 aumenta 33%.
- **Máximo:** o alvo de 200 KB segura até o pior caso teórico. Antes do HOTFIX 2 eram 370–860 KB; no teste do Zé, 520–556 KB.
- **Limite do servidor** (`FOTO_TAMANHO_MAX`, `lib/tecnico/comentarios.ts`): continua 1,5 MB. Ele não foi baixado para não recusar fotos antigas que ainda estejam na fila de algum aparelho. A foto que nem no último degrau fica abaixo dele é recusada no aparelho, com aviso.

## 2. A conta: fotos por dia → MB por mês

Base: **0,25 MB por foto no banco** (a foto típica medida mais a miniatura, arredondada para cima) e **26 dias de trabalho por mês**.

| Fotos por dia | Por dia | **Por mês** | Em 12 meses |
|---|---|---|---|
| 20 | 5 MB | **130 MB** | 1,6 GB |
| 50 | 12,5 MB | **325 MB** | 3,9 GB |
| 100 | 25 MB | **650 MB** | 7,8 GB |
| 200 | 50 MB | **1,3 GB** | 15,6 GB |

"Centenas de mensagens por dia", com 1 foto a cada 5 mensagens, dá **~60 fotos por dia: ~390 MB por mês**.
- O banco de produção tem 64 MB hoje: **em 1 mês o chat seria ~6 vezes o banco inteiro**.
- O HOTFIX 2 cortou a conta pela metade (antes: ~810 MB por mês). Ela continua crescendo todo mês.

**O que isso custa no Neon:**
- **Armazenamento:** os planos pagos cobram **US$ 0,35 por GB-mês**, mais o histórico de restauração (~US$ 0,20 por GB-mês do que mudou). Com 100 fotos por dia, no 12º mês são 7,8 GB, **~US$ 2,70 por mês só de fotos, e subindo todo mês**.
- **Plano gratuito:** 0,5–1 GB por projeto. Com ~60 fotos por dia, encheria em 1 a 3 meses.
- **Backup e cópias:** todo `pg_dump` carrega as fotos, e o mesmo vale para as cópias de banco (branches). Um banco de 8 GB demora para baixar, restaurar e copiar.

**Consultas:** o PostgreSQL guarda textos grandes fora da linha (TOAST). Uma consulta que NÃO pede a coluna da foto não lê a foto, e é por isso que o item 3 importa: a garantia de que nenhuma listagem pede a coluna mantém o chat rápido mesmo com o banco grande. O que pesa é o tamanho total (custo, backup, cópias), não a velocidade das listagens.

## 3. Garantia: nenhuma listagem nem o tempo real lê a foto inteira

**O teste** (`tests/unit/chat-1-1-fotos-pg.test.ts`) roda no PostgreSQL real, pelas rotas reais, e registra **todo SQL** que o Prisma envia:
- **Rotas cobertas:**
  - escritório: lista por OS, conversa da OS, tempo real, lista por pessoa, conversa da pessoa (também com `?ate=`), comentários da OS, sino;
  - app: a conversa Escritório (também com `?ate=`), o tempo real e o retrato da atividade.
- **O que ele exige:** nenhuma dessas consultas lê `os_comentarios_fotos.conteudo`, e nenhuma resposta traz a foto inteira (marcada).
- **O peso da resposta:** a conversa com 30 fotos pesa o das 30 miniaturas (~15 KB cada), e não o das fotos (~200 KB cada; seriam ~6 MB).
- **O controle:** a rota de ampliar a foto (escritório e app) lê a coluna exatamente uma vez. Isso prova que o registro do SQL funciona.

**No código:** `conteudo: true` de `osComentarioFoto` aparece em um lugar só, `fotoDaMensagem` (`lib/execucao/comentarios.ts`), usado pelas duas rotas de ampliar.

**Um ponto a acompanhar: as miniaturas.** Elas vão dentro da conversa (data URL no JSON).
- Uma conversa de 300 mensagens com 1 foto a cada 5 leva ~60 miniaturas de ~15 KB: **~0,9 MB por leitura completa**.
- A conversa aberta se relê quando chega mensagem.
- A Fase 1 abaixo resolve isso: a miniatura vira um endereço que o navegador guarda em cache. Isso também pode ser feito antes, sem contratar nada, se o Zé preferir.

## 4. A proposta: os arquivos num armazenamento de arquivos

### O que muda

**O banco guarda só a referência** (a chave do arquivo, o tipo, o tamanho e um hash); o arquivo vai para o armazenamento.
- **Começa por:** chat (`os_comentarios_fotos`) e anexos da OS (`os_anexos`).
- **Depois, no mesmo molde:**
  - `anexos_cliente`, `anexos_contrato`, `orcamento_anexos`;
  - fotos de despesa, de atendimento e de serviço adicional;
  - checklist, fotos de equipamento e veículo;
  - prints de anotação.

**Privacidade:** as fotos do chat são internas. O armazenamento é **privado**, e nenhum arquivo tem endereço público.
- **Quem vê:** a pessoa continua pedindo a foto às rotas de hoje (`/api/conversas/fotos/[id]` e as dos anexos), que conferem a permissão.
- **Como a rota entrega:** devolve um **endereço assinado de poucos minutos**, ou repassa o arquivo.

**O app offline não muda:** o aparelho continua mandando a foto pela fila, e é o servidor quem grava no armazenamento.

### As opções e o custo

**Uso considerado:**
- 100 fotos por dia (2.600 por mês, ~0,5 GB por mês em arquivo binário, já sem os 33% do base64 e com a compressão do HOTFIX 2), 12 meses ≈ 6 GB;
- cada foto vista inteira ~5 vezes; as miniaturas em cache.

| | **Vercel Blob (privado)** | **Cloudflare R2** | AWS S3 (São Paulo) | Ficar no Neon |
|---|---|---|---|---|
| Armazenamento | US$ 0,023 por GB-mês; o plano Pro inclui 5 GB | US$ 0,015 por GB-mês; 10 GB grátis | US$ 0,0405 por GB-mês | US$ 0,35 por GB-mês, mais o histórico |
| Saída (download) | US$ 0,05 por GB; o Pro inclui 100 GB | grátis | cobrada por GB (confirmar o preço atual) | (dentro do plano) |
| Operações | US$ 5 por milhão de gravações; US$ 0,40 por milhão de leituras | US$ 4,50 por milhão de gravações; US$ 0,36 por milhão de leituras; 1 e 10 milhões grátis | por requisição | — |
| **12º mês (6 GB, ~2 GB de download por mês)** | **~US$ 0,02 por mês** (1 GB acima do incluído; download dentro dos 100 GB) | **grátis** (dentro dos 10 GB) | ~US$ 0,25 por mês, mais a saída | **~US$ 2,70 por mês** (7,8 GB em base64), subindo |
| Conta nova? | Não: o mesmo painel e a mesma fatura do Vercel | Sim: conta Cloudflare | Sim: conta AWS | — |
| Integração | SDK `@vercel/blob`; o token vem da Vercel | API S3 (SDK da AWS) | API S3 | — |

**Recomendação: Vercel Blob privado.**
- **Por quê:** o mesmo fornecedor e a mesma fatura; sem conta nova; o token de acesso fica nas variáveis da Vercel.
- **Custo:** na prática dentro do incluído do Pro durante o primeiro ano.
- **R2 como alternativa,** se o volume de download crescer muito (a saída do R2 é grátis). Como o acesso passa por uma camada própria (`lib/arquivos/`), trocar de um para o outro é um script de cópia.

**Preços conferidos em novembro de 2026** nas páginas públicas:
- [Vercel Blob](https://vercel.com/docs/vercel-blob/usage-and-pricing), também no [anúncio de disponibilidade](https://vercel.com/changelog/vercel-blob-is-now-generally-available);
- [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) e [tabela de preços da Cloudflare](https://www.cloudflare.com/en-in/rates/);
- Neon (US$ 0,35 por GB-mês, segundo guias de 2026 como [este](https://selfhost.dev/blog/neon-pricing-cost-of-serverless-postgres/); confirmar na página do Neon);
- S3 São Paulo (guia de terceiros, [Upstash](https://upstash.com/blog/aws-s3-pricing-explained-2026); confirmar na [página da AWS](https://aws.amazon.com/s3/pricing/)).

Os preços mudam: confirmar antes de contratar.

### Plano de migração (em fases; só a última é destrutiva)

**Fase 0 — decisão e conta (Zé).** Escolher o fornecedor. Criar o armazenamento privado no painel da Vercel. O token vai como variável de ambiente (`BLOB_READ_WRITE_TOKEN`), nunca no código.

**Fase 1 — gravar fora, ler dos dois (PR próprio, SQL só aditivo 🔵).**
- **Colunas novas:** em `os_comentarios_fotos` e `os_anexos`, `chave_arquivo` e `chave_miniatura` (texto, nulas), mais `sha256`. A coluna `conteudo` passa a aceitar vazio, o que só relaxa a regra; nenhuma linha muda.
- **`lib/arquivos/`:** um lugar só para gravar, gerar o endereço assinado e verificar. Por trás, o Vercel Blob; trocar por R2 ou S3 muda só ali.
- **Gravação nova:** grava o arquivo, confere o tamanho e o hash, e então cria a linha com a chave e sem `conteudo`. Se o armazenamento falhar, grava como hoje (`conteudo`) e marca para migrar depois: **o usuário nunca perde a foto**.
- **Leitura:** com chave, o endereço assinado; sem chave, o `conteudo`, como hoje.
- **Miniaturas:** viram endereço, com cache longo no navegador, o que tira o ~0,9 MB por leitura da conversa (item 3).

**Fase 2 — copiar o que já existe (script, reversível).**
- **O script:** um script de manutenção roda em lotes (ex.: 200 por vez, retomável). Para cada linha sem chave: envia o arquivo, confere o tamanho e o hash lendo de volta, e grava a chave. **O `conteudo` continua lá**, então desfazer é só limpar as chaves.
- **Relatório:** quantas linhas foram migradas, quantas falharam, e os bytes de cada lado.
- **Volume hoje:** com 64 MB de banco, o lote inicial é pequeno, de minutos.

**Fase 3 — liberar o espaço do banco (decisão SEPARADA do Zé; a única destrutiva).**
- **Quando:** depois de algumas semanas lendo pelo armazenamento sem falha.
- **O quê:** um SQL próprio esvazia `conteudo` onde há chave e verificação, e então `VACUUM`, para o espaço voltar a ser usado.
- **Antes:** uma cópia do banco (branch do Neon) e a conferência por hash.
- **Exceção às regras atuais:** este SQL **não é aditivo**. Por isso fica fora das levas normais, com aviso próprio.

**Fallback em cada fase:**
- **Armazenamento fora do ar ao gravar:** grava no banco como hoje, marcado para migrar; o script da Fase 2 recolhe depois.
- **Armazenamento fora do ar ao ler:**
  - Fases 1 e 2: lê do `conteudo`, que ainda existe.
  - Depois da Fase 3: a tela mostra "Foto indisponível no momento", tenta de novo, e a conversa segue (o texto e a miniatura em cache continuam).
- **Trocar de fornecedor:** as chaves são neutras (`empresa/tipo/ano/mês/id.jpg`); um script copia de um armazenamento para outro e troca só a configuração.
- **Voltar atrás antes da Fase 3:** apagar as chaves faz tudo ler do banco de novo.

### O que precisa do Zé
1. Escolher o fornecedor (recomendado: Vercel Blob privado).
2. Criar o armazenamento e a variável de ambiente.
3. Autorizar a Fase 1 como uma leva.
4. Mais tarde, decidir a Fase 3 (liberar o espaço), com o aviso de que é o único passo destrutivo.

**Para medir o banco de hoje sem mexer em nada** (o Zé roda; só leitura):

```sql
SELECT relname AS tabela, pg_size_pretty(pg_total_relation_size(relid)) AS tamanho
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;
```
