-- DOCUMENTAÇÃO DA EQUIPE PARA O CLIENTE — o pacote de documentos dos colaboradores que atendem um
-- cliente (ASO, NRs, ficha de EPI, contrato…), entregue por link público, zip ou e-mail.
--
-- O LEVANTAMENTO (o que já existia, para ninguém criar tabela à toa):
--   • OS ARQUIVOS JÁ EXISTEM: "colaborador_documentos" tem "categoria", "data_vencimento", "origem"
--     e exclusão com rastro. O pacote NÃO copia arquivo nenhum — aponta para os que já estão lá.
--   • O ZIP JÁ EXISTE (lib/zip.ts, com pastas), o E-MAIL JÁ EXISTE (lib/email.ts, com modelo por
--     empresa e "responder para") e o LIMITE POR IP dos links públicos JÁ EXISTE
--     ("tentativas_acesso", cujo "tipo" é texto — um contexto novo não pede coluna nem enum).
--   • O PADRÃO DO LINK PÚBLICO JÁ EXISTE: token aleatório guardado na própria linha, com validade,
--     como na admissão digital e no aceite da OS. Aqui é o mesmo — nenhuma tabela de tokens à parte.
--   • A PERMISSÃO é uma ação nova ("enviar") no módulo "documentos": mora no JSON do perfil, sem SQL.
--
-- O QUE ENTRA (três tabelas NOVAS; nenhuma tabela existente perde ou muda coluna):
--   1. "documentacao_envios": o pacote que foi montado — para qual cliente (e contrato), com quais
--      gavetas, como as pastas foram organizadas, por quem e quando. O link público é o "token"
--      (NULL enquanto o pacote só foi baixado em zip), com "expira_em" e "revogado_em/por".
--      Um envio é de UM cliente. O lote (renovação anual) é uma lista de envios individuais que
--      dividem o "lote_id": cada cliente tem o seu link, com os documentos dele.
--   2. "documentacao_envio_itens": a LISTA FECHADA do que o link entrega — um arquivo por linha,
--      apontando para "colaborador_documentos". É isto que garante a LGPD: o cliente só baixa o que
--      está aqui; nunca outro colaborador, nunca outra gaveta, nunca um documento anexado depois.
--      Nome do colaborador, gaveta, nome do arquivo e validade vão COPIADOS: o registro de que
--      aquele papel foi enviado àquele cliente sobrevive ao arquivo (ON DELETE SET NULL).
--   3. "documentacao_envio_eventos": a linha do tempo — o que a empresa fez (criou, gerou link,
--      baixou zip, mandou e-mail, revogou) e o que o cliente fez pelo link (abriu, baixou), com IP
--      e navegador. "usuario_id" NULL = o cliente, pelo link.
--
-- Nenhum dado é reescrito. Sem enum (os tipos são TEXTO, como na admissão e nos modelos).
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, e cada chave estrangeira só
-- é criada quando ainda não existe NESTA tabela (a guarda compara `conrelid` com a tabela, e não
-- só o nome — o nome de uma constraint só é único por tabela). Pode rodar de novo.
-- Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-08_documentacao_equipe.sql

BEGIN;

-- 1. O pacote enviado
CREATE TABLE IF NOT EXISTS "documentacao_envios" (
    "id"              TEXT         NOT NULL,
    "empresa_id"      TEXT         NOT NULL,
    -- SET NULL + nome copiado: o histórico de para quem foi continua legível se o cadastro sumir
    "cliente_id"      TEXT,
    "cliente_nome"    TEXT         NOT NULL,
    "contrato_id"     TEXT,
    -- As gavetas marcadas (ids de CATEGORIAS em lib/colaborador/documentos.ts)
    "categorias"      TEXT[],
    -- POR_COLABORADOR | POR_TIPO | COLABORADOR_E_TIPO
    "organizacao"     TEXT         NOT NULL DEFAULT 'POR_COLABORADOR',
    -- O segredo do link público; NULL enquanto o pacote só foi baixado em zip
    "token"           TEXT,
    "expira_em"       TIMESTAMP(3),
    -- Revogar não apaga: o link morre, o histórico fica
    "revogado_em"     TIMESTAMP(3),
    "revogado_por_id" TEXT,
    -- Os envios disparados juntos dividem este id (cada cliente continua com o seu link)
    "lote_id"         TEXT,
    "criado_por_id"   TEXT,
    "criado_em"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentacao_envios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "documentacao_envios_token_key"
    ON "documentacao_envios" ("token");
CREATE INDEX IF NOT EXISTS "documentacao_envios_empresa_id_criado_em_idx"
    ON "documentacao_envios" ("empresa_id", "criado_em");
CREATE INDEX IF NOT EXISTS "documentacao_envios_cliente_id_idx"
    ON "documentacao_envios" ("cliente_id");
CREATE INDEX IF NOT EXISTS "documentacao_envios_lote_id_idx"
    ON "documentacao_envios" ("lote_id");

-- 2. A lista fechada do que o link entrega
CREATE TABLE IF NOT EXISTS "documentacao_envio_itens" (
    "id"               TEXT         NOT NULL,
    "envio_id"         TEXT         NOT NULL,
    -- SET NULL + dados copiados: se o arquivo sair do banco, fica o registro de que foi enviado
    "documento_id"     TEXT,
    "colaborador_id"   TEXT,
    "colaborador_nome" TEXT         NOT NULL,
    "categoria"        TEXT         NOT NULL,
    "nome"             TEXT         NOT NULL,
    -- O caminho dentro do pacote ("Marina Alves/ASO - exame periódico.pdf")
    "caminho"          TEXT         NOT NULL,
    "data_vencimento"  TIMESTAMP(3),
    "tamanho"          INTEGER,

    CONSTRAINT "documentacao_envio_itens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "documentacao_envio_itens_envio_id_idx"
    ON "documentacao_envio_itens" ("envio_id");
CREATE INDEX IF NOT EXISTS "documentacao_envio_itens_documento_id_idx"
    ON "documentacao_envio_itens" ("documento_id");
CREATE INDEX IF NOT EXISTS "documentacao_envio_itens_colaborador_id_idx"
    ON "documentacao_envio_itens" ("colaborador_id");

-- 3. A linha do tempo (o que a empresa fez e o que o cliente fez pelo link)
CREATE TABLE IF NOT EXISTS "documentacao_envio_eventos" (
    "id"         TEXT         NOT NULL,
    "envio_id"   TEXT         NOT NULL,
    -- CRIADO | LINK_GERADO | ZIP_BAIXADO | EMAIL_ENVIADO | EMAIL_FALHOU | REVOGADO | ACESSO | DOWNLOAD | DOWNLOAD_ZIP
    "tipo"       TEXT         NOT NULL,
    -- Quem fez. NULL = o cliente, pelo link público
    "usuario_id" TEXT,
    "ip"         TEXT,
    "user_agent" TEXT,
    "detalhe"    JSONB,
    "criado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentacao_envio_eventos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "documentacao_envio_eventos_envio_id_criado_em_idx"
    ON "documentacao_envio_eventos" ("envio_id", "criado_em");

-- As chaves estrangeiras, cada uma só quando ainda não existe NESTA tabela.
-- CASCADE onde o pai manda na existência do filho (a empresa no envio; o envio nos itens e nos
-- eventos). SET NULL no resto: apagar o cliente, o contrato, quem enviou, o colaborador ou o
-- arquivo nunca pode apagar o registro de que aquele pacote foi enviado.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envios"')
                     AND conname = 'documentacao_envios_empresa_id_fkey') THEN
        ALTER TABLE "documentacao_envios"
            ADD CONSTRAINT "documentacao_envios_empresa_id_fkey"
            FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envios"')
                     AND conname = 'documentacao_envios_cliente_id_fkey') THEN
        ALTER TABLE "documentacao_envios"
            ADD CONSTRAINT "documentacao_envios_cliente_id_fkey"
            FOREIGN KEY ("cliente_id") REFERENCES "clientes" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envios"')
                     AND conname = 'documentacao_envios_contrato_id_fkey') THEN
        ALTER TABLE "documentacao_envios"
            ADD CONSTRAINT "documentacao_envios_contrato_id_fkey"
            FOREIGN KEY ("contrato_id") REFERENCES "contratos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envios"')
                     AND conname = 'documentacao_envios_criado_por_id_fkey') THEN
        ALTER TABLE "documentacao_envios"
            ADD CONSTRAINT "documentacao_envios_criado_por_id_fkey"
            FOREIGN KEY ("criado_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envios"')
                     AND conname = 'documentacao_envios_revogado_por_id_fkey') THEN
        ALTER TABLE "documentacao_envios"
            ADD CONSTRAINT "documentacao_envios_revogado_por_id_fkey"
            FOREIGN KEY ("revogado_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envio_itens"')
                     AND conname = 'documentacao_envio_itens_envio_id_fkey') THEN
        ALTER TABLE "documentacao_envio_itens"
            ADD CONSTRAINT "documentacao_envio_itens_envio_id_fkey"
            FOREIGN KEY ("envio_id") REFERENCES "documentacao_envios" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envio_itens"')
                     AND conname = 'documentacao_envio_itens_documento_id_fkey') THEN
        ALTER TABLE "documentacao_envio_itens"
            ADD CONSTRAINT "documentacao_envio_itens_documento_id_fkey"
            FOREIGN KEY ("documento_id") REFERENCES "colaborador_documentos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envio_itens"')
                     AND conname = 'documentacao_envio_itens_colaborador_id_fkey') THEN
        ALTER TABLE "documentacao_envio_itens"
            ADD CONSTRAINT "documentacao_envio_itens_colaborador_id_fkey"
            FOREIGN KEY ("colaborador_id") REFERENCES "tecnicos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envio_eventos"')
                     AND conname = 'documentacao_envio_eventos_envio_id_fkey') THEN
        ALTER TABLE "documentacao_envio_eventos"
            ADD CONSTRAINT "documentacao_envio_eventos_envio_id_fkey"
            FOREIGN KEY ("envio_id") REFERENCES "documentacao_envios" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documentacao_envio_eventos"')
                     AND conname = 'documentacao_envio_eventos_usuario_id_fkey') THEN
        ALTER TABLE "documentacao_envio_eventos"
            ADD CONSTRAINT "documentacao_envio_eventos_usuario_id_fkey"
            FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
