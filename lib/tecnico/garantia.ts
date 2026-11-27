/**
 * GARANTIA VISÍVEL NO APP — regra PURA. O dado é o do cadastro do equipamento (`garantia_ate`) e a situação é a
 * mesma do escritório (lib/equipamento-garantia: vigente, vencendo em até 30 dias, vencida; o dia do fim conta
 * inteiro, em Brasília). Aqui só se escreve a frase curta que o técnico lê na lista, no equipamento e na ficha.
 */
import { situacaoGarantia, type SituacaoGarantia } from "@/lib/equipamento-garantia";
import { formatarData } from "@/lib/utils";

export interface SeloGarantia { situacao: SituacaoGarantia; texto: string }

/** "Em garantia até 12/03/2027" · "Garantia vence em 12/03/2027" · "Garantia vencida em 12/03/2025"; sem data = null */
export function seloGarantia(fim: Date | string | null | undefined, hoje: Date = new Date()): SeloGarantia | null {
  // Sem data, ou data que não se lê: sem selo (nunca "Garantia vence em —")
  const situacao = fim && !Number.isNaN(new Date(fim).getTime()) ? situacaoGarantia(fim, hoje) : null;
  if (!situacao) return null;
  const data = formatarData(fim);
  const texto = situacao === "vigente" ? `Em garantia até ${data}` : situacao === "vencendo" ? `Garantia vence em ${data}` : `Garantia vencida em ${data}`;
  return { situacao, texto };
}
