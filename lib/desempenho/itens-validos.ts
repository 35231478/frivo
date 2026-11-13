/**
 * DESEMPENHO — quais itens da revisão VALEM como penalidade.
 *
 * A NOTA do cliente NÃO é penalidade: ela pesa na média da avaliação, e só nela. A penalidade fica
 * para:
 *  - RETORNO;
 *  - RECLAMAÇÃO (registrada à mão);
 *  - RESSALVA escrita pelo cliente no aceite — TODA ressalva, com nota ou sem. A ressalva é um sinal
 *    qualitativo à parte: um cliente que dá 5 estrelas e ainda assim escreve um problema não pode
 *    ter a reclamação escondida pela nota alta. Quem revisa decide se conta.
 *
 * Itens antigos de NOTA BAIXA (da primeira versão) continuam no banco como histórico, mas não
 * aparecem na lista, não podem ser decididos e não descontam nada — mesmo os que já estavam "Conta".
 */
import type { Prisma } from "@prisma/client";

export const ITENS_QUE_VALEM = {
  tipo: { in: ["RETORNO", "RECLAMACAO", "RESSALVA"] },
} satisfies Prisma.DesempenhoPenalidadeWhereInput;
