import type { TipoPrecoTabela } from "@prisma/client";

/**
 * Calcula o valor final de um item de tabela de preço.
 * - VALOR_FIXO: usa o valor fixo informado.
 * - DESCONTO_PERCENTUAL: aplica o desconto sobre o valor padrão do cadastro.
 */
export function calcularValorFinalTabela(
  tipoPreco: TipoPrecoTabela | string,
  valorFixo: number | null | undefined,
  descontoPercent: number | null | undefined,
  valorPadraoCadastro: number | null | undefined,
): number {
  if (tipoPreco === "DESCONTO_PERCENTUAL") {
    const base = Number(valorPadraoCadastro) || 0;
    const desc = Number(descontoPercent) || 0;
    return Math.max(0, Math.round(base * (1 - desc / 100) * 100) / 100);
  }
  return Math.max(0, Math.round((Number(valorFixo) || 0) * 100) / 100);
}
