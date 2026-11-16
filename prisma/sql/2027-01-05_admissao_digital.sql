-- ADMISSÃO DIGITAL — o colaborador preenche a própria ficha por um link, assina o contrato e o RH
-- baixa tudo pronto para o contador.
--
-- O que entra (tudo ADITIVO; nada é removido, alterado nem preenchido):
--   1. "admissoes": o CONVITE. Uma linha por admissão de um colaborador já pré-cadastrado pelo RH.
--      Guarda o token do link e a validade, a situação (CONVIDADO → PREENCHENDO → AGUARDANDO_
--      ASSINATURA → ASSINADO → ENVIADO_CONTADOR → ADMITIDO, mais CANCELADA e EXPIRADA), o envio
--      (quando, por onde, para quem, quantas vezes), o consentimento LGPD (data, IP e navegador),
--      o rascunho em JSON (o colaborador fecha e volta sem perder nada), a prova da assinatura
--      (nome digitado, IP, navegador, data/hora), a selfie, o texto do contrato congelado no
--      momento da assinatura, e os marcos de cancelamento, envio ao contador e admissão.
--   2. "admissao_config": a configuração POR EMPRESA — modelo de contrato, texto das orientações
--      finais, lista de documentos (obrigatórios × opcionais) em JSON, validade padrão do link e o
--      período de experiência. Nada hardcoded: o que varia entre empresas mora aqui.
--   3. "colaborador_dependentes": os dependentes do colaborador (IRRF e salário-família), que a
--      ficha de admissão pede e o cadastro ainda não tinha.
--   4. Colunas novas em "tecnicos" (o cadastro do colaborador), todas opcionais: os dados que o
--      eSocial pede e que o cadastro ainda não guardava — PIS/NIS, CTPS, nome da mãe e do pai,
--      estado civil, escolaridade, nacionalidade, naturalidade, sexo, título de eleitor,
--      reservista, e os dados bancários da folha (banco, agência, conta, tipo e chave PIX).
--      Os colaboradores que já existem ficam exatamente como estão (NULL em todas).
--   5. Uma coluna "cbo" em "cargos" (opcional): a Ficha de Admissão pede o código da ocupação.
--
-- Nenhuma tabela existente perde ou muda coluna. Nenhum dado é reescrito. A SITUAÇÃO da admissão
-- mora só em "admissoes" — o cadastro do colaborador não ganha um segundo lugar para a mesma
-- verdade; a tela do colaborador lê a situação pela admissão dele.
--
-- IDEMPOTENTE: IF NOT EXISTS em tabela, colunas e índices; cada chave estrangeira só é criada
-- quando ainda não existe NESTA TABELA — o nome de uma constraint não é único no banco (só por
-- tabela), então a guarda compara `conrelid` com a tabela, e não só o nome: olhando só o nome,
-- um homônimo em outro schema faria o script PULAR a chave estrangeira em silêncio.
-- Pode rodar mais de uma vez. Sem enum (situação, estado civil, escolaridade e tipo de conta são
-- TEXTO, como no fechamento do Desempenho e nas recorrentes). Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-05_admissao_digital.sql

BEGIN;

-- 1. O convite de admissão
CREATE TABLE IF NOT EXISTS "admissoes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "colaborador_id" TEXT NOT NULL,
    -- Token forte do link público (randomBytes(32).base64url). Único no banco inteiro.
    "token" TEXT NOT NULL,
    -- CONVIDADO | PREENCHENDO | AGUARDANDO_ASSINATURA | ASSINADO | ENVIADO_CONTADOR | ADMITIDO |
    -- CANCELADA | EXPIRADA
    "situacao" TEXT NOT NULL DEFAULT 'CONVIDADO',
    "expira_em" TIMESTAMP(3) NOT NULL,
    "criado_por_id" TEXT,

    -- Envio do link
    "enviado_em" TIMESTAMP(3),
    "enviado_canal" TEXT,
    "enviado_para" TEXT,
    "envios" INTEGER NOT NULL DEFAULT 0,

    -- O colaborador abriu o link pela primeira vez
    "aberto_em" TIMESTAMP(3),

    -- Consentimento LGPD: sem isto o formulário não abre
    "consentimento_em" TIMESTAMP(3),
    "consentimento_ip" TEXT,
    "consentimento_user_agent" TEXT,

    -- Rascunho etapa a etapa (fecha e volta sem perder nada) e onde parou
    "rascunho" JSONB,
    "etapa" TEXT,
    "concluido_em" TIMESTAMP(3),

    -- Assinatura do contrato: a mesma prova do aceite da OS (nome + IP + navegador + data/hora)
    "assinatura_nome" TEXT,
    "assinatura_ip" TEXT,
    "assinatura_user_agent" TEXT,
    "assinatura_em" TIMESTAMP(3),
    -- Selfie da assinatura (data URL), tratada como dado sensível
    "selfie" TEXT,
    -- O contrato preenchido, congelado no momento da assinatura (prova do que foi assinado)
    "contrato_texto" TEXT,

    -- Cancelamento: nunca apaga, muda a situação e guarda a razão
    "cancelada_em" TIMESTAMP(3),
    "cancelada_por_id" TEXT,
    "cancelamento_motivo" TEXT,

    -- Marcos do RH
    "enviado_contador_em" TIMESTAMP(3),
    "enviado_contador_por_id" TEXT,
    "admitido_em" TIMESTAMP(3),

    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admissoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admissoes_token_key" ON "admissoes" ("token");
CREATE INDEX IF NOT EXISTS "admissoes_empresa_id_situacao_idx" ON "admissoes" ("empresa_id", "situacao");
CREATE INDEX IF NOT EXISTS "admissoes_colaborador_id_idx" ON "admissoes" ("colaborador_id");

-- 2. A configuração por empresa (uma linha por empresa)
CREATE TABLE IF NOT EXISTS "admissao_config" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    -- Modelo do contrato com os campos entre chaves ({{nome}}, {{cargo}}, {{salario}}…).
    -- Vazio = a empresa ainda não definiu: o sistema não inventa cláusula.
    "contrato_modelo" TEXT,
    -- Orientações finais (exame admissional, o que levar no primeiro dia, contato do responsável)
    "orientacoes" TEXT,
    -- [{ "id": "rg", "rotulo": "RG (frente e verso)", "obrigatorio": true }, …]
    "documentos" JSONB,
    "validade_dias" INTEGER NOT NULL DEFAULT 7,
    "experiencia_dias" INTEGER NOT NULL DEFAULT 45,
    "experiencia_prorrogacao_dias" INTEGER NOT NULL DEFAULT 45,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admissao_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admissao_config_empresa_id_key" ON "admissao_config" ("empresa_id");

-- 3. Dependentes do colaborador (a ficha pede; o cadastro ainda não tinha)
CREATE TABLE IF NOT EXISTS "colaborador_dependentes" (
    "id" TEXT NOT NULL,
    "colaborador_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nascimento" TIMESTAMP(3),
    "cpf" TEXT,
    -- FILHO | CONJUGE | ENTEADO | OUTRO
    "parentesco" TEXT NOT NULL DEFAULT 'FILHO',
    "irrf" BOOLEAN NOT NULL DEFAULT false,
    "salario_familia" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colaborador_dependentes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "colaborador_dependentes_colaborador_id_idx"
    ON "colaborador_dependentes" ("colaborador_id");

-- 4. O que faltava no cadastro do colaborador (tudo opcional; ninguém muda)
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "pis" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "ctps_numero" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "ctps_serie" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "ctps_uf" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "nome_mae" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "nome_pai" TEXT;
-- SOLTEIRO | CASADO | DIVORCIADO | VIUVO | UNIAO_ESTAVEL
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "estado_civil" TEXT;
-- FUNDAMENTAL_INCOMPLETO | FUNDAMENTAL | MEDIO_INCOMPLETO | MEDIO | TECNICO | SUPERIOR_INCOMPLETO | SUPERIOR | POS
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "escolaridade" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "nacionalidade" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "naturalidade" TEXT;
-- M | F | OUTRO
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "sexo" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "titulo_eleitor" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "reservista" TEXT;
-- Dados bancários da folha
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "banco" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "agencia" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "conta" TEXT;
-- CORRENTE | POUPANCA | SALARIO
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "conta_tipo" TEXT;
ALTER TABLE "tecnicos" ADD COLUMN IF NOT EXISTS "pix_chave" TEXT;

-- 5. O CBO do cargo (a Ficha de Admissão pede o código da ocupação)
ALTER TABLE "cargos" ADD COLUMN IF NOT EXISTS "cbo" TEXT;

-- 6. Chaves estrangeiras (só quando ainda não existem NESTA tabela)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"admissoes"') AND conname = 'admissoes_empresa_id_fkey') THEN
        ALTER TABLE "admissoes"
            ADD CONSTRAINT "admissoes_empresa_id_fkey"
            FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"admissoes"') AND conname = 'admissoes_colaborador_id_fkey') THEN
        ALTER TABLE "admissoes"
            ADD CONSTRAINT "admissoes_colaborador_id_fkey"
            FOREIGN KEY ("colaborador_id") REFERENCES "tecnicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"admissoes"') AND conname = 'admissoes_criado_por_id_fkey') THEN
        ALTER TABLE "admissoes"
            ADD CONSTRAINT "admissoes_criado_por_id_fkey"
            FOREIGN KEY ("criado_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"admissoes"') AND conname = 'admissoes_cancelada_por_id_fkey') THEN
        ALTER TABLE "admissoes"
            ADD CONSTRAINT "admissoes_cancelada_por_id_fkey"
            FOREIGN KEY ("cancelada_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"admissoes"') AND conname = 'admissoes_enviado_contador_por_id_fkey') THEN
        ALTER TABLE "admissoes"
            ADD CONSTRAINT "admissoes_enviado_contador_por_id_fkey"
            FOREIGN KEY ("enviado_contador_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"admissao_config"') AND conname = 'admissao_config_empresa_id_fkey') THEN
        ALTER TABLE "admissao_config"
            ADD CONSTRAINT "admissao_config_empresa_id_fkey"
            FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"colaborador_dependentes"') AND conname = 'colaborador_dependentes_colaborador_id_fkey') THEN
        ALTER TABLE "colaborador_dependentes"
            ADD CONSTRAINT "colaborador_dependentes_colaborador_id_fkey"
            FOREIGN KEY ("colaborador_id") REFERENCES "tecnicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
