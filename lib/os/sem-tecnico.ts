/**
 * OS SEM TÉCNICO — a regra única (painel de pendências, sino e o filtro /ordens?tecnico=sem).
 *
 * Conta a OS em aberto que alguém precisa atribuir:
 *  - com atividade em aberto (agendada ou em andamento) sem técnico; ou
 *  - ainda sem nenhuma atividade (a cancelada não conta).
 * A OS com todas as atividades concluídas não entra: ela espera o fechamento, não um técnico.
 * O técnico da atividade é o responsável (`tecnicoId`); a equipe sempre tem um responsável.
 */
import { STATUS_FINAIS_OS } from "@/lib/os/prazo-execucao";

/** Atividade que ainda vai acontecer ou está acontecendo */
export const ATIVIDADE_EM_ABERTO = ["AGENDADA", "EM_ANDAMENTO"] as const;

/** O valor do filtro na URL da lista de OS (`?tecnico=sem`) */
export const FILTRO_SEM_TECNICO = "sem";

export function whereOsSemTecnico() {
  return {
    status: { notIn: [...STATUS_FINAIS_OS] },
    OR: [
      { atividades: { some: { status: { in: [...ATIVIDADE_EM_ABERTO] }, tecnicoId: null } } },
      { atividades: { none: { status: { not: "CANCELADA" as const } } } },
    ],
  };
}
