-- Frivo IA: registro de uso/custo do assistente (uma linha por pergunta).
-- Aditivo e idempotente (pode rodar mais de uma vez). Não altera nenhuma tabela existente.
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção.
-- Sem esta tabela o chat continua funcionando (só não registra o uso nem aplica o limite por hora).

CREATE TABLE IF NOT EXISTS ia_uso (
  id                   TEXT PRIMARY KEY,
  empresa_id           TEXT NOT NULL,
  usuario_id           TEXT NOT NULL,
  modelo               TEXT NOT NULL,
  pergunta             TEXT NOT NULL,
  ferramentas          TEXT[] NOT NULL DEFAULT '{}',
  tokens_entrada       INTEGER NOT NULL DEFAULT 0,
  tokens_saida         INTEGER NOT NULL DEFAULT 0,
  tokens_cache_leitura INTEGER NOT NULL DEFAULT 0,
  tokens_cache_escrita INTEGER NOT NULL DEFAULT 0,
  custo_usd            DECIMAL(12,6) NOT NULL DEFAULT 0,
  sucesso              BOOLEAN NOT NULL DEFAULT TRUE,
  erro                 TEXT,
  duracao_ms           INTEGER NOT NULL DEFAULT 0,
  criado_em            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ia_uso_empresa_id_criado_em_idx ON ia_uso(empresa_id, criado_em);
CREATE INDEX IF NOT EXISTS ia_uso_usuario_id_criado_em_idx ON ia_uso(usuario_id, criado_em);

-- Conferência (deve retornar 1 linha):
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'ia_uso';

-- Consulta útil depois: custo por usuário no mês
-- SELECT usuario_id, count(*) perguntas, sum(custo_usd) custo_usd
--   FROM ia_uso WHERE criado_em >= date_trunc('month', now()) GROUP BY usuario_id ORDER BY 3 DESC;
