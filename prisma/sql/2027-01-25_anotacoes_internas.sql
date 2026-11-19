-- ANOTAÇÕES INTERNAS (ferramenta de construção do dono do Frivo — não é recurso do cliente).
--
-- O QUE É: de qualquer tela do painel, o dono do Frivo marca um ponto exato, escreve o que
--     mudar/melhorar ali, e a anotação guarda o contexto automático (qual tela, qual elemento) mais
--     um print do momento. Serve para virar prompt depois, sem depender da memória.
--
-- QUEM VÊ: SÓ o usuário com role = 'SUPER_ADMIN' (a chave da ferramenta). Nenhum cliente do Frivo
--     vê o botão, o modo, a tela ou os dados — nem o ADMIN da própria empresa dele, que é o
--     administrador do CLIENTE, não o dono do produto. A trava é em três camadas no código
--     (montagem no layout, bundle sob demanda, 403 no servidor), e esta tabela é só o depósito.
--
-- SUPER_ADMIN NÃO É CHAVE-MESTRA: o papel abre a ferramenta, e NADA MAIS. O isolamento
--     multiempresa continua valendo igual para ele — toda consulta do sistema (e todas as desta
--     tabela) fica presa à empresa da sessão. Um SUPER_ADMIN da empresa A não alcança dado da
--     empresa B em lugar nenhum. Há teste travando isso (tests/unit/anotacoes-pg.test.ts).
--
-- O LEVANTAMENTO (o que já existia):
--   • role 'SUPER_ADMIN' JÁ EXISTE no enum "Role" do schema e `pode()` já o reconhece como acesso
--     total DENTRO da empresa dele — mas NINGUÉM é criado com esse papel (o seed cria ADMIN e
--     nenhuma rota de criação o oferece). Era um papel dormente; passa a ser a chave da ferramenta.
--     Promover um usuário é um UPDATE de uma linha, em arquivo separado
--     (2027-01-25_promover_super_admin.sql), para rodar à mão quando quiser.
--   • Não havia nenhuma tabela de anotação, feedback ou comentário interno. Nada é reaproveitado
--     nem alterado: as duas tabelas abaixo são novas e nascem vazias.
--   • O print é guardado em base64 numa coluna TEXT, como o sistema já guarda foto de equipamento
--     e anexo de OS. Sem storage externo, sem dependência nova de infraestrutura.
--
-- O QUE ENTRA (ADITIVO; nada é removido, alterado ou preenchido):
--   1. "anotacoes_internas" — a anotação, a âncora do ponto exato e o status.
--   2. "anotacao_prints"    — o print, 1-1 com a anotação, em tabela SEPARADA de propósito: assim a
--      listagem nunca arrasta base64 (ela lê só a anotação); a imagem vem por rota própria, do
--      mesmo jeito que os anexos.
--
-- POR QUE RODAR ISTO NÃO MUDA NADA PARA NINGUÉM:
--   As duas tabelas nascem VAZIAS e só recebem linha quando um SUPER_ADMIN anota algo. Como não
--   existe nenhum SUPER_ADMIN até o UPDATE de promoção ser rodado, o estado do sistema depois
--   deste SQL é idêntico ao de antes. NÃO HÁ BACKFILL, NÃO HÁ SEED, NÃO HÁ RETROATIVO.
--
-- A ÂNCORA DO PONTO EXATO (por que são tantas colunas): o ponto é "preso" ao elemento em quatro
--   camadas, que degradam uma na outra para a anotação NUNCA se perder quando a tela mudar:
--     1. "tela"      — a rota normalizada (/ordens/:id), que agrupa a lista por TELA, não por registro;
--     2. "ancora"    — o marco semântico mais próximo do clique (data-* estático ou id) + o índice
--                      entre os irmãos de mesma chave (data-cartao aparece 17x numa tela);
--     3. "caminho" + "rotulo" + "papel" — o caminho curto RELATIVO à âncora e a identidade do
--                      elemento (texto, tag, role): é o texto que mais sobrevive a refatoração;
--     4. "fx"/"fy"   — o clique em FRAÇÃO do retângulo da âncora (não em pixel), para o pin
--                      acompanhar o elemento quando ele muda de tamanho; "x"/"y"/"viewport_w"
--                      ficam como último recurso.
--   Quando nada é reencontrado, o pin não aparece na tela e a anotação fica na lista marcada como
--   âncora perdida, abrindo o print. Ela muda de estado; não desaparece.
--
-- "status" é TEXT (não enum), como "modulo" em empresa_modulos e o motivo do atraso: a validação
-- mora em código (lib/anotacoes/regras.ts), e um status novo não exige mexer no banco.
-- Sem tabela além destas duas, sem índice além do necessário. Pode rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS "anotacoes_internas" (
  "id"           TEXT NOT NULL,
  "empresa_id"   TEXT NOT NULL,
  "usuario_id"   TEXT NOT NULL,

  -- Camada 1: a tela
  "tela"         TEXT NOT NULL,
  "rota"         TEXT NOT NULL,
  "titulo_tela"  TEXT,

  -- Camada 2: o marco semântico
  "ancora"        TEXT,
  "ancora_indice" INTEGER NOT NULL DEFAULT 0,

  -- Camada 3: caminho curto relativo + identidade do elemento
  "caminho"      TEXT,
  "rotulo"       TEXT,
  "papel"        TEXT,

  -- Camada 4: geometria relativa (e o último recurso absoluto)
  "fx"           DOUBLE PRECISION,
  "fy"           DOUBLE PRECISION,
  "x"            INTEGER,
  "y"            INTEGER,
  "viewport_w"   INTEGER,

  -- A anotação
  "texto"        TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'aberta',

  "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvido_em"  TIMESTAMP(3),

  CONSTRAINT "anotacoes_internas_pkey" PRIMARY KEY ("id")
);

-- A leitura da tela "Minhas anotações": as do dono, por status e por tela
CREATE INDEX IF NOT EXISTS "anotacoes_internas_empresa_id_usuario_id_status_idx"
  ON "anotacoes_internas" ("empresa_id", "usuario_id", "status");
CREATE INDEX IF NOT EXISTS "anotacoes_internas_empresa_id_usuario_id_tela_idx"
  ON "anotacoes_internas" ("empresa_id", "usuario_id", "tela");

-- O print, 1-1 com a anotação: fora da tabela de cima para a listagem não arrastar base64
CREATE TABLE IF NOT EXISTS "anotacao_prints" (
  "anotacao_id" TEXT NOT NULL,
  -- data URL (image/jpeg;base64) da VIEWPORT no momento do clique, já reduzida no navegador
  "conteudo"    TEXT NOT NULL,
  "largura"     INTEGER NOT NULL,
  "altura"      INTEGER NOT NULL,
  -- Onde o pin estava DENTRO da imagem (fração 0..1): desenha o alvo sem reprocessar o print
  "print_fx"    DOUBLE PRECISION,
  "print_fy"    DOUBLE PRECISION,
  "bytes"       INTEGER NOT NULL,
  "criado_em"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "anotacao_prints_pkey" PRIMARY KEY ("anotacao_id")
);

-- A empresa some, as anotações dela somem junto; o usuário some, as anotações dele somem junto
-- (a anotação é de quem escreveu — não há dado de cliente a preservar aqui).
-- A anotação some, o print dela some junto.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anotacoes_internas_empresa_id_fkey') THEN
    ALTER TABLE "anotacoes_internas"
      ADD CONSTRAINT "anotacoes_internas_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anotacoes_internas_usuario_id_fkey') THEN
    ALTER TABLE "anotacoes_internas"
      ADD CONSTRAINT "anotacoes_internas_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anotacao_prints_anotacao_id_fkey') THEN
    ALTER TABLE "anotacao_prints"
      ADD CONSTRAINT "anotacao_prints_anotacao_id_fkey"
      FOREIGN KEY ("anotacao_id") REFERENCES "anotacoes_internas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
