-- DOCUMENTOS NA FICHA DO COLABORADOR — o RH guarda contrato, ASO, NR e o resto dos papéis de cada
-- pessoa a qualquer momento (o caso que pediu isto: os contratos dos colaboradores legados, que
-- vieram da plataforma anterior em papel).
--
-- O LEVANTAMENTO (o que já existia, para ninguém aplicar coluna à toa):
--   • A tabela "colaborador_documentos" JÁ EXISTE e já guarda tipo, nome, arquivo e
--     "data_vencimento". A validade por documento NÃO precisa de coluna nova — a aba Documentos da
--     ficha já destacava "vencido" e "vence em 30 dias", e a lista de colaboradores já tem os
--     filtros "documento vencido" e "documento vencendo" lendo essa mesma coluna.
--   • A admissão digital JÁ grava os arquivos que o colaborador manda NESTA MESMA TABELA (com
--     "tipo" = o id do documento que a empresa pede: "rg", "ctps"…). Não há lista paralela: o que
--     faltava era a ficha mostrar esses arquivos junto dos que o RH anexa.
--
-- O QUE ENTRA (tudo ADITIVO; nenhuma coluna é removida, alterada ou preenchida com palpite):
--   1. "categoria": a gaveta do documento (contrato, documento pessoal, ASO, NR-10, NR-35, NR-13,
--      ficha de EPI, integração…). A coluna "tipo" FICA COMO ESTÁ, porque ela é o protocolo da
--      admissão (o id do documento pedido) e também o rótulo dos documentos antigos. Enquanto
--      "categoria" for NULL, a tela lê o "tipo" exatamente como lia antes — nenhum documento
--      legado é reclassificado por adivinhação.
--   2. "criado_por_id": quem anexou (NULL = o próprio colaborador, pela admissão, ou documento
--      antigo de antes desta coluna).
--   3. "excluido_em" e "excluido_por_id": exclusão COM RASTRO. Excluir some da ficha e não some do
--      banco — fica quem apagou e quando. É o oposto do que acontecia até aqui: salvar a ficha
--      apagava e recriava a lista inteira de documentos, sem registro de nada.
--   4. "origem": MANUAL (o RH anexou) ou ADMISSAO (o colaborador mandou pelo link). Os documentos
--      que já existem ficam MANUAL, que é a verdade deles — a admissão digital só agora ganhou
--      tela, e os arquivos dela são marcados na hora em que chegam.
--   5. "arquivo_tipo" e "tamanho": o que o arquivo é (application/pdf, image/jpeg) e quantos bytes
--      tem, lidos dos BYTES no momento do envio. Serve a lista ("PDF · 240 KB") e o pacote que
--      será enviado ao cliente mais adiante.
--   6. Um índice em (colaborador_id, excluido_em): a ficha e os filtros de vencimento passam a
--      pedir sempre "os não excluídos deste colaborador".
--
-- Nenhuma tabela existente perde ou muda coluna. Nenhum dado é reescrito.
--
-- IDEMPOTENTE: IF NOT EXISTS em colunas e índices; cada chave estrangeira só é criada quando ainda
-- não existe NESTA TABELA — o nome de uma constraint não é único no banco (só por tabela), então a
-- guarda compara `conrelid` com a tabela, e não só o nome: olhando só o nome, um homônimo em outro
-- schema faria o script PULAR a chave estrangeira em silêncio. Pode rodar mais de uma vez.
-- Sem enum (origem é TEXTO, como a situação da admissão e o tipo de conta). Não usa `prisma migrate`.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção (Neon):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-01-06_colaborador_documentos.sql

BEGIN;

-- 1 a 5. As colunas novas, todas opcionais
ALTER TABLE "colaborador_documentos" ADD COLUMN IF NOT EXISTS "categoria" TEXT;
ALTER TABLE "colaborador_documentos" ADD COLUMN IF NOT EXISTS "criado_por_id" TEXT;
ALTER TABLE "colaborador_documentos" ADD COLUMN IF NOT EXISTS "excluido_em" TIMESTAMP(3);
ALTER TABLE "colaborador_documentos" ADD COLUMN IF NOT EXISTS "excluido_por_id" TEXT;
ALTER TABLE "colaborador_documentos" ADD COLUMN IF NOT EXISTS "origem" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "colaborador_documentos" ADD COLUMN IF NOT EXISTS "arquivo_tipo" TEXT;
ALTER TABLE "colaborador_documentos" ADD COLUMN IF NOT EXISTS "tamanho" INTEGER;

-- 6. A ficha e os filtros de vencimento pedem "os não excluídos deste colaborador"
CREATE INDEX IF NOT EXISTS "colaborador_documentos_colaborador_id_excluido_em_idx"
    ON "colaborador_documentos" ("colaborador_id", "excluido_em");

-- Chaves estrangeiras de autoria (só quando ainda não existem NESTA tabela).
-- ON DELETE SET NULL: apagar o usuário não pode apagar o documento do colaborador — perde-se o
-- nome de quem anexou, nunca o papel da pessoa.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"colaborador_documentos"')
                     AND conname = 'colaborador_documentos_criado_por_id_fkey') THEN
        ALTER TABLE "colaborador_documentos"
            ADD CONSTRAINT "colaborador_documentos_criado_por_id_fkey"
            FOREIGN KEY ("criado_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = to_regclass('"colaborador_documentos"')
                     AND conname = 'colaborador_documentos_excluido_por_id_fkey') THEN
        ALTER TABLE "colaborador_documentos"
            ADD CONSTRAINT "colaborador_documentos_excluido_por_id_fkey"
            FOREIGN KEY ("excluido_por_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
