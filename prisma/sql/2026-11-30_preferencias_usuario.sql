-- Tabelas profissionais (PR B) — preferência POR USUÁRIO das telas de lista: larguras das colunas
-- e colunas visíveis, uma linha por usuário e chave ("tabela:orcamentos"). Segue o usuário entre
-- dispositivos; o localStorage do navegador é só a reserva enquanto carrega.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado.

-- 1) A tabela (valor em JSONB: { "larguras": { "coluna": px }, "ocultas": ["coluna"] })
CREATE TABLE IF NOT EXISTS "preferencias_usuario" (
  "id"            TEXT NOT NULL,
  "usuario_id"    TEXT NOT NULL,
  "chave"         TEXT NOT NULL,
  "valor"         JSONB NOT NULL,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "preferencias_usuario_pkey" PRIMARY KEY ("id")
);

-- 2) Uma preferência por usuário e chave (gravar 2× a mesma chave atualiza, não duplica)
CREATE UNIQUE INDEX IF NOT EXISTS "preferencias_usuario_usuario_id_chave_key" ON "preferencias_usuario"("usuario_id", "chave");

-- 3) Apagar o usuário apaga as preferências dele
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preferencias_usuario_usuario_id_fkey' AND conrelid = '"preferencias_usuario"'::regclass) THEN
    ALTER TABLE "preferencias_usuario" ADD CONSTRAINT "preferencias_usuario_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
