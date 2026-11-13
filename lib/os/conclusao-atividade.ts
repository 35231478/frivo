/**
 * A DATA DE CONCLUSÃO da atividade (coluna "concluida_em"). O status sozinho não diz QUANDO a
 * atividade terminou — e sem isso não dá para saber se foi no prazo (módulo Desempenho).
 *
 *  - concluir grava o momento; repetir a conclusão não muda a data já gravada;
 *  - reabrir limpa a data (a próxima conclusão grava a nova);
 *  - no app do técnico, vale a hora do TOQUE no aparelho (mesmo sem sinal), não a hora em que a
 *    fila chegou ao servidor — com o mesmo cuidado do "A caminho / Cheguei" (lib/tecnico/aviso-cliente).
 */
import { horarioDoToque } from "@/lib/tecnico/aviso-cliente";

/** Toque guardado no aparelho há mais tempo que isto não é levado em conta: vale a hora da chegada. */
export const MAX_ATRASO_CONCLUSAO_MS = 7 * 24 * 60 * 60 * 1000;

export interface RelogioDaConclusao { em?: string | null; agoraAparelho?: string | null }

/** Quando a atividade foi concluída: a hora do toque no aparelho (se veio e é plausível) ou agora. */
export function momentoDaConclusao(relogio: RelogioDaConclusao | null | undefined, agora: Date = new Date()): Date {
  if (!relogio?.em) return agora;
  const { registradoEm, atrasoMs } = horarioDoToque(relogio.em, agora.getTime(), relogio.agoraAparelho);
  return atrasoMs > MAX_ATRASO_CONCLUSAO_MS ? agora : registradoEm;
}

/** O que gravar em "concluida_em" quando o status muda (objeto vazio = não mexe na data). */
export function marcaDeConclusao(antes: string, depois: string, quando: Date = new Date()): { concluidaEm?: Date | null } {
  if (depois === "CONCLUIDA" && antes !== "CONCLUIDA") return { concluidaEm: quando };
  if (depois !== "CONCLUIDA" && antes === "CONCLUIDA") return { concluidaEm: null };
  return {};
}
