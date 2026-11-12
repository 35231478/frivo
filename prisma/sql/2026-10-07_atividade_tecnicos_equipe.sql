-- OS: vários técnicos na mesma atividade + equipe usada.
-- Aditivo e idempotente (pode rodar mais de uma vez). Nada é removido ou alterado nas atividades existentes.
--   atividades_os.tecnico_id continua sendo o técnico RESPONSÁVEL (líder da equipe ou o 1º escolhido).
--   atividade_tecnicos: os demais técnicos da atividade.
--   atividades_os.equipe_id: equipe usada para preencher os técnicos (opcional, só registro).
-- Rode ANTES do deploy do código que usa estes campos.

CREATE TABLE IF NOT EXISTS atividade_tecnicos (
  atividade_id TEXT NOT NULL,
  tecnico_id   TEXT NOT NULL,
  criado_em    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT atividade_tecnicos_pkey PRIMARY KEY (atividade_id, tecnico_id),
  CONSTRAINT atividade_tecnicos_atividade_id_fkey FOREIGN KEY (atividade_id) REFERENCES atividades_os(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT atividade_tecnicos_tecnico_id_fkey FOREIGN KEY (tecnico_id) REFERENCES tecnicos(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS atividade_tecnicos_tecnico_id_idx ON atividade_tecnicos(tecnico_id);

ALTER TABLE atividades_os ADD COLUMN IF NOT EXISTS equipe_id TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atividades_os_equipe_id_fkey') THEN
    ALTER TABLE atividades_os
      ADD CONSTRAINT atividades_os_equipe_id_fkey FOREIGN KEY (equipe_id) REFERENCES equipes(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS atividades_os_equipe_id_idx ON atividades_os(equipe_id);
