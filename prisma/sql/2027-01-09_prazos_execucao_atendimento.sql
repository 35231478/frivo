-- PRAZOS DA OS, em DOIS conceitos separados (PR 1: banco e motor; nenhuma tela nova):
--
--   • PRAZO DE EXECUÇÃO (da OS): até que dia o técnico tem para terminar aquela OS. É o "Prazo para
--     finalizar" da tela. Alimenta o Calendário e o Dashboard (atrasadas) e, no PR 3, o desempenho.
--   • PRAZO DE ATENDIMENTO (do contrato): o que a empresa promete ao cliente no contrato de
--     manutenção ("comparecer em 4 h", "resolver em 24 h"), contado da ABERTURA DO CHAMADO pelo
--     cliente — não da criação da OS.
--
-- O LEVANTAMENTO (o que já existia):
--   • "ordens_servico"."previsao_conclusao" fazia cinco papéis ao mesmo tempo: era o "Prazo para
--     finalizar" digitado na OS manual, a data agendada da OS recorrente e do PMOC, a data/hora
--     marcada ao aceitar uma solicitação, a posição da OS no calendário (e o que o arrasto muda) e o
--     mês em "a faturar". A coluna FICA, com um papel só: a DATA PREVISTA (agenda). O prazo ganha
--     coluna própria.
--   • O contrato NÃO tinha nenhum campo de prazo. Só a proposta de contrato tem (prazo emergencial,
--     normal e horário), e esses campos não chegavam ao contrato.
--   • Não havia onde guardar "o cliente abriu em": no portal e no QR a OS nasce na hora da abertura;
--     no chamado por telefone a data era a do lançamento.
--
-- O QUE ENTRA (tudo ADITIVO; nenhuma coluna é removida, alterada ou preenchida com palpite):
--   1. "ordens_servico"."prazo_execucao" (DATE): o prazo de execução. NULL = sem prazo próprio, e aí
--      o sistema continua usando o dia previsto, exatamente como hoje. Por isso NÃO há preenchimento
--      retroativo: toda OS que estava atrasada continua atrasada e nenhuma passa a estar.
--   2. "ordens_servico": o ATRASO JUSTIFICADO — motivo, observação, quem marcou e quando. Só o gestor
--      marca (tela no PR 2); tira o atraso do desempenho (PR 3).
--   3. "ordens_servico": o PRAZO DE ATENDIMENTO desta OS — quando o cliente abriu o chamado, os dois
--      limites (comparecer e resolver) congelados nessa hora e quando o técnico compareceu.
--   4. "tipos_os"."prazo_execucao_dias": prazo de execução padrão do tipo, em dias contados do dia
--      agendado. NULL = sem padrão (digita-se como hoje).
--   5. "contrato_prazos_atendimento": tabela NOVA, uma linha por contrato e prioridade do chamado,
--      com as horas para comparecer, as horas para resolver e "só em horário comercial".
--   6. Um índice em ("empresa_id", "prazo_execucao"): a conta de OS atrasadas do dashboard e do sino.
--
-- Nenhuma tabela existente perde ou muda coluna. Nenhum dado é reescrito.
--
-- IDEMPOTENTE: IF NOT EXISTS em tabela, colunas e índices; cada chave estrangeira só é criada quando
-- ainda não existe NESTA TABELA (a guarda compara `conrelid`, não só o nome: nome de constraint não é
-- único no banco). Pode rodar mais de uma vez. Usa o enum "Prioridade", que já existe. Não usa
-- `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-09_prazos_execucao_atendimento.sql

BEGIN;

-- 1. Prazo de execução (dia civil, sem hora)
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "prazo_execucao" DATE;

-- 2. Atraso justificado
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "atraso_justificado_motivo" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "atraso_justificado_obs" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "atraso_justificado_por_id" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "atraso_justificado_em" TIMESTAMP(3);

-- 3. Prazo de atendimento desta OS (só chamado de cliente em contrato)
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "chamado_aberto_em" TIMESTAMP(3);
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "atendimento_comparecer_ate" TIMESTAMP(3);
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "atendimento_resolver_ate" TIMESTAMP(3);
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "atendimento_comparecido_em" TIMESTAMP(3);

-- 4. Prazo de execução padrão do tipo de OS (dias a partir do dia agendado)
ALTER TABLE "tipos_os" ADD COLUMN IF NOT EXISTS "prazo_execucao_dias" INTEGER;

-- 5. O que o contrato promete, por prioridade do chamado
CREATE TABLE IF NOT EXISTS "contrato_prazos_atendimento" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "prioridade" "Prioridade" NOT NULL,
    "comparecer_horas" INTEGER,
    "resolver_horas" INTEGER,
    "so_horario_comercial" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contrato_prazos_atendimento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "contrato_prazos_atendimento_empresa_id_idx"
    ON "contrato_prazos_atendimento" ("empresa_id");

-- Uma linha por contrato e prioridade
CREATE UNIQUE INDEX IF NOT EXISTS "contrato_prazos_atendimento_contrato_id_prioridade_key"
    ON "contrato_prazos_atendimento" ("contrato_id", "prioridade");

-- 6. A conta de OS atrasadas (dashboard e sino)
CREATE INDEX IF NOT EXISTS "ordens_servico_empresa_id_prazo_execucao_idx"
    ON "ordens_servico" ("empresa_id", "prazo_execucao");

-- Chaves estrangeiras (só quando ainda não existem NESTA tabela).
--   • prazo do contrato: ON DELETE CASCADE — a promessa é do contrato e some com ele;
--   • quem justificou o atraso: ON DELETE SET NULL — apagar o usuário não pode apagar a OS nem a
--     justificativa; perde-se só o nome de quem marcou.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"contrato_prazos_atendimento"')
                     AND conname = 'contrato_prazos_atendimento_contrato_id_fkey') THEN
        ALTER TABLE "contrato_prazos_atendimento"
            ADD CONSTRAINT "contrato_prazos_atendimento_contrato_id_fkey"
            FOREIGN KEY ("contrato_id") REFERENCES "contratos" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"ordens_servico"')
                     AND conname = 'ordens_servico_atraso_justificado_por_id_fkey') THEN
        ALTER TABLE "ordens_servico"
            ADD CONSTRAINT "ordens_servico_atraso_justificado_por_id_fkey"
            FOREIGN KEY ("atraso_justificado_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
