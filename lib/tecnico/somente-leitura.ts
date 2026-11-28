/**
 * A faixa "só leitura" da OS no app do técnico. Atividade CANCELADA pelo escritório não é "concluída": o técnico
 * precisa saber que a visita foi cancelada (e que reabrir é com o escritório), não que ele terminou o serviço.
 */
export type TomFaixa = "ok" | "atencao";
export interface FaixaSomenteLeitura { texto: string; tom: TomFaixa }

export const MSG_CANCELADA = "Atividade cancelada pelo escritório. Só leitura: se precisar voltar a ela, fale com o escritório.";

export function faixaSomenteLeitura(status: string, aEnviar = 0): FaixaSomenteLeitura {
  if (status === "CANCELADA") return { texto: MSG_CANCELADA, tom: "atencao" };
  return { texto: `Atividade concluída${aEnviar ? " no aparelho (a enviar)" : ""}. Só leitura.`, tom: "ok" };
}
