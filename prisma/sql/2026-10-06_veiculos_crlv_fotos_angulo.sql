-- Veículos: campos lidos do CRLV e fotos por ângulo.
-- Aditivo e idempotente (pode rodar mais de uma vez). Nada é removido ou alterado.
--   combustivel   : texto livre, normalizado pela tela (Gasolina, Etanol, Flex, Diesel, GNV, Elétrico, Híbrido, Outro)
--   ano_modelo    : ano modelo do CRLV ("ano" continua sendo o ano de fabricação)
--   fotos_rotulos : ângulo de cada foto, na mesma ordem de "fotos"
--                   (FRENTE, TRASEIRA, LATERAL_ESQUERDA, LATERAL_DIREITA, OUTRO); vazio nos veículos antigos
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS combustivel   TEXT;
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS ano_modelo    TEXT;
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS fotos_rotulos TEXT[] NOT NULL DEFAULT '{}';
