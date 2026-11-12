/**
 * Campos do veículo que a IA lê do CRLV (arquivo puro: tela e servidor).
 * Só dados do VEÍCULO — nenhum dado do proprietário tem campo aqui.
 */
export const TIPOS_VEICULO_OCR = ["CARRO", "VAN", "MOTO", "CAMINHAO", "OUTRO"] as const;
export const COMBUSTIVEIS = ["Gasolina", "Etanol", "Flex", "Diesel", "GNV", "Elétrico", "Híbrido", "Outro"] as const;

export const CAMPOS_CRLV = [
  "placa", "marca", "modelo", "ano_fabricacao", "ano_modelo", "cor", "combustivel", "tipo", "chassi", "renavam", "exercicio",
] as const;
export type CampoCrlv = (typeof CAMPOS_CRLV)[number];

/** Rótulo na conferência e o campo do cadastro que recebe o valor. */
export const CAMPOS_CRLV_CADASTRO: Record<CampoCrlv, { rotulo: string; destino: string }> = {
  placa: { rotulo: "Placa", destino: "placa" },
  marca: { rotulo: "Marca", destino: "marca" },
  modelo: { rotulo: "Modelo / versão", destino: "modelo" },
  ano_fabricacao: { rotulo: "Ano de fabricação", destino: "ano" },
  ano_modelo: { rotulo: "Ano modelo", destino: "anoModelo" },
  cor: { rotulo: "Cor", destino: "cor" },
  combustivel: { rotulo: "Combustível", destino: "combustivel" },
  tipo: { rotulo: "Tipo", destino: "tipo" },
  chassi: { rotulo: "Chassi", destino: "chassi" },
  renavam: { rotulo: "RENAVAM", destino: "renavam" },
  exercicio: { rotulo: "Exercício do licenciamento", destino: "documentos (CRLV)" },
};
