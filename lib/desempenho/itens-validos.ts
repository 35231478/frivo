/**
 * DESEMPENHO — quais itens da revisão VALEM como penalidade.
 *
 * A nota baixa do cliente NÃO é penalidade: ela já pesa na média da avaliação, e descontar pontos
 * de novo seria cobrar duas vezes. A penalidade fica para:
 *  - RETORNO;
 *  - RECLAMAÇÃO (registrada à mão);
 *  - RESSALVA do cliente SEM nota (com nota, a insatisfação já está na média).
 *
 * Itens antigos de nota baixa (e de ressalva com nota) continuam no banco como histórico, mas não
 * aparecem na lista, não podem ser decididos e não descontam nada — mesmo os que já estavam "Conta".
 */
import type { Prisma } from "@prisma/client";

export const ITENS_QUE_VALEM = {
  OR: [
    { tipo: { in: ["RETORNO", "RECLAMACAO"] } },
    { tipo: "RESSALVA", ordemServico: { is: { aceite: { is: { avaliacao: null } } } } },
  ],
} satisfies Prisma.DesempenhoPenalidadeWhereInput;
