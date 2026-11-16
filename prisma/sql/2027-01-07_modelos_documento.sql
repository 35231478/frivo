-- MODELOS DE DOCUMENTO — o motor único que gera ficha de entrega de EPI, termo de
-- responsabilidade, advertência/suspensão e aditivo de contrato a partir de um modelo da empresa.
--
-- O LEVANTAMENTO (o que já existia, para ninguém criar tabela à toa):
--   • O MOTOR JÁ EXISTE, com um tipo só: o contrato da admissão digital. O modelo com os campos
--     entre chaves mora em "admissao_config.contrato_modelo", quem troca {{campo}} pelo valor é
--     `montarContrato()`, e o PDF assinado (texto congelado + nome + IP + navegador + hora + foto)
--     já é guardado como anexo do colaborador. Esta leva generaliza isso; não reinventa nada.
--   • A GAVETA E A VALIDADE JÁ EXISTEM: "colaborador_documentos" tem "categoria", "origem",
--     "data_vencimento" e exclusão com rastro. A categoria "ficha_epi" já está na lista da casa.
--     O documento gerado cai ali como qualquer outro papel — sem lista paralela.
--   • O CRUD JÁ TEM CASA: o kit de cadastros padronizados (lista, abas, busca, ações em massa,
--     validação que recusa campo desconhecido) atende o cadastro dos modelos.
--
-- O QUE ENTRA (duas tabelas NOVAS; nenhuma tabela existente perde ou muda coluna):
--   1. "documento_modelos": o modelo da empresa — nome, tipo, o texto com os campos entre chaves,
--      a gaveta onde o papel gerado cai, se tem lista de itens (a ficha de EPI tem: item, CA,
--      quantidade, entrega), de quantos dias é a validade (NULL = não vence) e se pede assinatura.
--      Único por (empresa, nome): dois modelos com o mesmo nome só geram dúvida na hora de escolher.
--   2. "documento_emitidos": o papel que foi gerado para uma pessoa — o que, quando, por quem, e
--      assinado ou não. O texto vai CONGELADO: mudar o modelo depois não altera o que foi entregue,
--      pela mesma razão que o contrato da admissão é congelado na assinatura.
--      "documento_id" aponta para o anexo que o papel virou na ficha (ON DELETE SET NULL: excluir o
--      anexo, que já é com rastro, não apaga o histórico de que o documento existiu).
--      "cancelado_em/por/motivo": advertência não some sem rastro — cancela, não apaga.
--
-- Nenhum dado é reescrito. Sem enum (tipo é TEXTO, como a situação da admissão).
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, e cada chave estrangeira só
-- é criada quando ainda não existe NESTA tabela — a guarda compara `conrelid` com a tabela, e não
-- só o nome, porque o nome de uma constraint não é único no banco (só por tabela): olhando só o
-- nome, um homônimo em outro schema faria o script PULAR a chave em silêncio. Pode rodar de novo.
-- Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-07_modelos_documento.sql

BEGIN;

-- 1. O modelo da empresa
CREATE TABLE IF NOT EXISTS "documento_modelos" (
    "id"               TEXT         NOT NULL,
    "empresa_id"       TEXT         NOT NULL,
    "nome"             TEXT         NOT NULL,
    -- EPI | TERMO | ADVERTENCIA | ADITIVO | OUTRO
    "tipo"             TEXT         NOT NULL,
    "texto"            TEXT         NOT NULL,
    -- NULL = a categoria padrão do tipo (lib/documentos/modelos.ts)
    "categoria"        TEXT,
    "tem_itens"        BOOLEAN      NOT NULL DEFAULT false,
    -- NULL = não vence
    "validade_dias"    INTEGER,
    "exige_assinatura" BOOLEAN      NOT NULL DEFAULT true,
    "ativo"            BOOLEAN      NOT NULL DEFAULT true,
    "criado_por_id"    TEXT,
    "criado_em"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documento_modelos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "documento_modelos_empresa_id_nome_key"
    ON "documento_modelos" ("empresa_id", "nome");
CREATE INDEX IF NOT EXISTS "documento_modelos_empresa_id_ativo_idx"
    ON "documento_modelos" ("empresa_id", "ativo");

-- 2. O papel gerado para uma pessoa
CREATE TABLE IF NOT EXISTS "documento_emitidos" (
    "id"                    TEXT         NOT NULL,
    "empresa_id"            TEXT         NOT NULL,
    "colaborador_id"        TEXT         NOT NULL,
    -- O modelo que deu origem; SET NULL para o papel assinado sobreviver ao modelo
    "modelo_id"             TEXT,
    -- Copiados do modelo na emissão: o histórico não muda quando o modelo mudar
    "tipo"                  TEXT         NOT NULL,
    "titulo"                TEXT         NOT NULL,
    "texto"                 TEXT         NOT NULL,
    -- { "motivo": "…" } e [{ "descricao": "Luva", "ca": "12345", "quantidade": 2 }, …]
    "valores"               JSONB,
    "itens"                 JSONB,
    -- A prova da assinatura, a mesma da admissão
    "assinatura_nome"       TEXT,
    "assinatura_ip"         TEXT,
    "assinatura_user_agent" TEXT,
    "assinatura_em"         TIMESTAMP(3),
    "selfie"                TEXT,
    -- O anexo que este papel virou na seção Documentos da ficha
    "documento_id"          TEXT,
    -- Cancelamento: nunca apaga, guarda a razão e quem
    "cancelado_em"          TIMESTAMP(3),
    "cancelado_por_id"      TEXT,
    "cancelamento_motivo"   TEXT,
    "criado_por_id"         TEXT,
    "criado_em"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documento_emitidos_pkey" PRIMARY KEY ("id")
);

-- Um anexo nasce de um documento emitido só — por isso o índice único
CREATE UNIQUE INDEX IF NOT EXISTS "documento_emitidos_documento_id_key"
    ON "documento_emitidos" ("documento_id");
CREATE INDEX IF NOT EXISTS "documento_emitidos_empresa_id_tipo_idx"
    ON "documento_emitidos" ("empresa_id", "tipo");
CREATE INDEX IF NOT EXISTS "documento_emitidos_colaborador_id_cancelado_em_idx"
    ON "documento_emitidos" ("colaborador_id", "cancelado_em");

-- As chaves estrangeiras, cada uma só quando ainda não existe NESTA tabela.
-- CASCADE onde o pai manda na existência do filho (empresa, colaborador); SET NULL em autoria,
-- modelo e anexo: apagar quem criou, o modelo ou o arquivo nunca pode apagar o registro de que o
-- documento existiu.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documento_modelos"')
                     AND conname = 'documento_modelos_empresa_id_fkey') THEN
        ALTER TABLE "documento_modelos"
            ADD CONSTRAINT "documento_modelos_empresa_id_fkey"
            FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documento_modelos"')
                     AND conname = 'documento_modelos_criado_por_id_fkey') THEN
        ALTER TABLE "documento_modelos"
            ADD CONSTRAINT "documento_modelos_criado_por_id_fkey"
            FOREIGN KEY ("criado_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documento_emitidos"')
                     AND conname = 'documento_emitidos_empresa_id_fkey') THEN
        ALTER TABLE "documento_emitidos"
            ADD CONSTRAINT "documento_emitidos_empresa_id_fkey"
            FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documento_emitidos"')
                     AND conname = 'documento_emitidos_colaborador_id_fkey') THEN
        ALTER TABLE "documento_emitidos"
            ADD CONSTRAINT "documento_emitidos_colaborador_id_fkey"
            FOREIGN KEY ("colaborador_id") REFERENCES "tecnicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documento_emitidos"')
                     AND conname = 'documento_emitidos_modelo_id_fkey') THEN
        ALTER TABLE "documento_emitidos"
            ADD CONSTRAINT "documento_emitidos_modelo_id_fkey"
            FOREIGN KEY ("modelo_id") REFERENCES "documento_modelos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documento_emitidos"')
                     AND conname = 'documento_emitidos_documento_id_fkey') THEN
        ALTER TABLE "documento_emitidos"
            ADD CONSTRAINT "documento_emitidos_documento_id_fkey"
            FOREIGN KEY ("documento_id") REFERENCES "colaborador_documentos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documento_emitidos"')
                     AND conname = 'documento_emitidos_criado_por_id_fkey') THEN
        ALTER TABLE "documento_emitidos"
            ADD CONSTRAINT "documento_emitidos_criado_por_id_fkey"
            FOREIGN KEY ("criado_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"documento_emitidos"')
                     AND conname = 'documento_emitidos_cancelado_por_id_fkey') THEN
        ALTER TABLE "documento_emitidos"
            ADD CONSTRAINT "documento_emitidos_cancelado_por_id_fkey"
            FOREIGN KEY ("cancelado_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
