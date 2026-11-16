-- CONTAS A PAGAR RECORRENTES — a despesa que se repete (aluguel, internet, assinatura, salário).
--
-- O que entra (tudo ADITIVO; nada é removido, alterado nem preenchido):
--   1. "contas_pagar_recorrencias": a REGRA que se repete. Guarda o favorecido (fornecedor OU
--      colaborador), o que cada ocorrência herda (categoria, centro de custo, forma de pagamento,
--      descrição, observação), a frequência (a cada N meses), o dia de vencimento e o ajuste de fim
--      de semana, o valor de CADA ocorrência (não multiplica), o início, o término (por competência
--      final, por número de ocorrências, ou nenhum = indefinido) e a situação (ATIVA, PAUSADA,
--      ENCERRADA). Nasce vazia.
--   2. Cinco colunas novas em "contas_pagar", todas opcionais e com valor padrão onde cabe:
--      - "recorrencia_id" + "ref_ano" + "ref_mes": a regra que gerou a conta e a competência dela;
--      - "valor_estimado" (BOOLEAN, default false): a conta nasce "a confirmar" (energia, água,
--        cartão) e a pessoa ajusta quando chega o boleto;
--      - "tecnico_id": favorecido colaborador (salário/pró-labore). O nome continua em "fornecedor".
--      As contas que já existem ficam exatamente como estão (NULL nas três primeiras, false no
--      "valor_estimado", NULL no "tecnico_id").
--   3. Um índice ÚNICO (recorrencia_id, ref_ano, ref_mes): é ele que impede gerar a mesma conta
--      duas vezes. Como as colunas são NULL nas contas antigas e avulsas, o índice não as afeta
--      (no Postgres, NULL não conflita com NULL).
--
-- Nenhuma tabela existente perde ou muda coluna. Nenhum dado é reescrito.
--
-- IDEMPOTENTE: IF NOT EXISTS em tabela, colunas e índices; cada chave estrangeira só é criada
-- quando ainda não existe. Pode rodar mais de uma vez. Sem enum (situação e ajuste são TEXTO, como
-- no fechamento do Desempenho). Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-04_contas_pagar_recorrentes.sql

BEGIN;

-- 1. A regra da despesa recorrente
CREATE TABLE IF NOT EXISTS "contas_pagar_recorrencias" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "fornecedor_id" TEXT,
    "tecnico_id" TEXT,
    "favorecido_nome" TEXT NOT NULL,
    "categoria_id" TEXT,
    "centro_custo_id" TEXT,
    "forma_pagamento" "FormaPagamento",
    "observacao" TEXT,
    "passo_meses" INTEGER NOT NULL DEFAULT 1,
    "dia_vencimento" INTEGER NOT NULL,
    "ajuste_dia_nao_util" TEXT NOT NULL DEFAULT 'MANTER',
    "valor" DECIMAL(12,2) NOT NULL,
    "valor_estimado" BOOLEAN NOT NULL DEFAULT false,
    "inicio_ano" INTEGER NOT NULL,
    "inicio_mes" INTEGER NOT NULL,
    "fim_ano" INTEGER,
    "fim_mes" INTEGER,
    "ocorrencias" INTEGER,
    "situacao" TEXT NOT NULL DEFAULT 'ATIVA',
    "pausada_em" TIMESTAMP(3),
    "encerrada_em" TIMESTAMP(3),
    "encerramento_motivo" TEXT,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_pagar_recorrencias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "contas_pagar_recorrencias_empresa_id_situacao_idx"
    ON "contas_pagar_recorrencias" ("empresa_id", "situacao");
CREATE INDEX IF NOT EXISTS "contas_pagar_recorrencias_fornecedor_id_idx"
    ON "contas_pagar_recorrencias" ("fornecedor_id");
CREATE INDEX IF NOT EXISTS "contas_pagar_recorrencias_tecnico_id_idx"
    ON "contas_pagar_recorrencias" ("tecnico_id");

-- 2. As colunas da OCORRÊNCIA na conta a pagar (todas opcionais; as contas atuais não mudam)
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "recorrencia_id" TEXT;
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "ref_ano" INTEGER;
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "ref_mes" INTEGER;
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "valor_estimado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contas_pagar" ADD COLUMN IF NOT EXISTS "tecnico_id" TEXT;

-- 3. A trava do dedup: uma conta por competência da regra
CREATE UNIQUE INDEX IF NOT EXISTS "contas_pagar_recorrencia_id_ref_ano_ref_mes_key"
    ON "contas_pagar" ("recorrencia_id", "ref_ano", "ref_mes");
CREATE INDEX IF NOT EXISTS "contas_pagar_recorrencia_id_idx" ON "contas_pagar" ("recorrencia_id");
CREATE INDEX IF NOT EXISTS "contas_pagar_tecnico_id_idx" ON "contas_pagar" ("tecnico_id");

-- 4. Chaves estrangeiras (só quando ainda não existem)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_pagar_recorrencias_empresa_id_fkey') THEN
        ALTER TABLE "contas_pagar_recorrencias"
            ADD CONSTRAINT "contas_pagar_recorrencias_empresa_id_fkey"
            FOREIGN KEY ("empresa_id") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_pagar_recorrencias_fornecedor_id_fkey') THEN
        ALTER TABLE "contas_pagar_recorrencias"
            ADD CONSTRAINT "contas_pagar_recorrencias_fornecedor_id_fkey"
            FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_pagar_recorrencias_tecnico_id_fkey') THEN
        ALTER TABLE "contas_pagar_recorrencias"
            ADD CONSTRAINT "contas_pagar_recorrencias_tecnico_id_fkey"
            FOREIGN KEY ("tecnico_id") REFERENCES "tecnicos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_pagar_recorrencias_categoria_id_fkey') THEN
        ALTER TABLE "contas_pagar_recorrencias"
            ADD CONSTRAINT "contas_pagar_recorrencias_categoria_id_fkey"
            FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_pagar_recorrencias_centro_custo_id_fkey') THEN
        ALTER TABLE "contas_pagar_recorrencias"
            ADD CONSTRAINT "contas_pagar_recorrencias_centro_custo_id_fkey"
            FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_pagar_recorrencia_id_fkey') THEN
        ALTER TABLE "contas_pagar"
            ADD CONSTRAINT "contas_pagar_recorrencia_id_fkey"
            FOREIGN KEY ("recorrencia_id") REFERENCES "contas_pagar_recorrencias" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_pagar_tecnico_id_fkey') THEN
        ALTER TABLE "contas_pagar"
            ADD CONSTRAINT "contas_pagar_tecnico_id_fkey"
            FOREIGN KEY ("tecnico_id") REFERENCES "tecnicos" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;

-- Conferência rápida depois de rodar:
--   SELECT count(*) FROM contas_pagar_recorrencias;                      -- 0 (nasce vazia)
--   SELECT count(*) FROM contas_pagar WHERE recorrencia_id IS NOT NULL;  -- 0 (nada foi tocado)
--   SELECT count(*) FROM contas_pagar WHERE valor_estimado;              -- 0
