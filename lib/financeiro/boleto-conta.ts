import { lerBoleto } from "@/lib/financeiro/boleto";

/**
 * O que gravar na conta a pagar a partir do boleto colado. `undefined` = não mexe; "" ou null = tira o
 * boleto; senão os DVs são conferidos e ficam a linha digitável e o código de barras (só dígitos).
 */
export function boletoParaGravar(texto: string | null | undefined):
  | { ok: true; dados: { linhaDigitavel?: string | null; codigoBarrasBoleto?: string | null } }
  | { ok: false; erro: string } {
  if (texto === undefined) return { ok: true, dados: {} };
  if (texto === null || !texto.replace(/\D/g, "")) return { ok: true, dados: { linhaDigitavel: null, codigoBarrasBoleto: null } };
  const r = lerBoleto(texto);
  if (!r.ok) return { ok: false, erro: `Boleto: ${r.erro}` };
  return { ok: true, dados: { linhaDigitavel: r.boleto.linhaDigitavel, codigoBarrasBoleto: r.boleto.codigoBarras } };
}
