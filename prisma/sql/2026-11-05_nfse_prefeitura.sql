-- NFS-e — autenticação da prefeitura (nfse.config.prefeitura no PlugNotas).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado. Sem enum.
-- Login e senha do portal de NFS-e da prefeitura ficam SÓ criptografados (AES-256-GCM, chave
-- ENCRYPTION_KEY do servidor, ver lib/crypto.ts): o PATCH /empresa do PlugNotas manda o
-- nfse.config inteiro a cada salvamento, então a credencial precisa estar à mão para reenviar.

ALTER TABLE "empresa_fiscal" ADD COLUMN IF NOT EXISTS "prefeitura_cripto" TEXT;
ALTER TABLE "empresa_fiscal" ADD COLUMN IF NOT EXISTS "prefeitura_atualizada_em" TIMESTAMP(3);
