/**
 * Status AUTOMÁTICO da OS (central de controle): derivado do estado real — atividades,
 * conclusão e medição — em vez de depender de alguém trocar o select. Funções puras: a
 * gravação e o histórico ficam em `lib/os/sincronizar-status.ts`.
 *
 * Estágios (a barra de progresso da tela):
 *   ABERTA → AGENDADA → EM_ANDAMENTO → CONCLUIDA → FATURADA   (+ CANCELADA fora da linha)
 *
 * "Faturada" não é um status gravado: é a OS CONCLUÍDA que já entrou numa medição.
 */
export type EstagioOs = "ABERTA" | "AGENDADA" | "EM_ANDAMENTO" | "CONCLUIDA" | "FATURADA" | "CANCELADA";
export type StatusOsGravado =
  | "ABERTA" | "AGUARDANDO_ATENDIMENTO" | "AGENDADA" | "EM_ANDAMENTO" | "PAUSADA" | "AGUARDANDO_PECA" | "CONCLUIDA" | "CANCELADA";

export const ESTAGIOS_LINHA: Exclude<EstagioOs, "CANCELADA">[] = ["ABERTA", "AGENDADA", "EM_ANDAMENTO", "CONCLUIDA", "FATURADA"];

export const ROTULO_ESTAGIO: Record<EstagioOs, string> = {
  ABERTA: "Aberta", AGENDADA: "Agendada", EM_ANDAMENTO: "Em execução",
  CONCLUIDA: "Concluída", FATURADA: "Faturada", CANCELADA: "Cancelada",
};

export interface AtividadeParaStatus { status: string; dataAgendada: Date | string | null }
export interface MedicaoParaStatus { status: string }

/** Medição que conta como "faturada": qualquer uma que não foi cancelada (gerada ou aprovada). */
export const medicaoValida = (m: MedicaoParaStatus) => m.status !== "CANCELADA";

/**
 * O que a OS É agora, pelos fatos:
 *  - Cancelada: a OS foi inativada;
 *  - Concluída: tem atividade e TODAS as não canceladas estão concluídas (a conclusão de cada
 *    uma já passou pela trava de equipamento da Etapa 1) — e Faturada se já entrou em medição;
 *  - Em execução: alguma atividade começou (ou umas concluídas e outras não);
 *  - Agendada: alguma atividade está agendada COM data;
 *  - Aberta: nada disso ainda.
 */
export function estagioAutomatico(os: {
  status: string;
  atividades: AtividadeParaStatus[];
  medicoes?: MedicaoParaStatus[];
}): EstagioOs {
  if (os.status === "CANCELADA") return "CANCELADA";
  const ativas = os.atividades.filter((a) => a.status !== "CANCELADA");
  const concluidas = ativas.filter((a) => a.status === "CONCLUIDA").length;
  if (ativas.length > 0 && concluidas === ativas.length) {
    return (os.medicoes ?? []).some(medicaoValida) ? "FATURADA" : "CONCLUIDA";
  }
  if (ativas.some((a) => a.status === "EM_ANDAMENTO") || concluidas > 0) return "EM_ANDAMENTO";
  if (ativas.some((a) => a.status === "AGENDADA" && a.dataAgendada)) return "AGENDADA";
  return "ABERTA";
}

/** Status que se GRAVA para um estágio (Faturada é Concluída no banco). */
export function statusDoEstagio(e: EstagioOs): StatusOsGravado {
  return e === "FATURADA" ? "CONCLUIDA" : e;
}

/** Estágio que um status GRAVADO representa na barra (as exceções manuais caem em "Em execução"). */
export function estagioDoStatus(status: string, medicoes: MedicaoParaStatus[] = []): EstagioOs {
  switch (status) {
    case "ABERTA": case "AGUARDANDO_ATENDIMENTO": return "ABERTA";
    case "AGENDADA": return "AGENDADA";
    case "EM_ANDAMENTO": case "PAUSADA": case "AGUARDANDO_PECA": return "EM_ANDAMENTO";
    case "CONCLUIDA": return medicoes.some(medicaoValida) ? "FATURADA" : "CONCLUIDA";
    default: return "CANCELADA";
  }
}

/**
 * O status gravado já CORRESPONDE ao estágio? "Aguardando atendimento" (chamado do portal/QR
 * que ninguém pegou) é a mesma coisa que "Aberta" — o automático não troca uma pela outra.
 */
export function statusCorresponde(status: string, estagio: EstagioOs): boolean {
  const alvo = statusDoEstagio(estagio);
  if (alvo === "ABERTA") return status === "ABERTA" || status === "AGUARDANDO_ATENDIMENTO";
  return status === alvo;
}

/** O que a tela mostra: com ajuste manual vale o gravado; sem ajuste, o automático. */
export function resumoStatus(os: {
  status: string;
  statusManual: boolean;
  atividades: AtividadeParaStatus[];
  medicoes?: MedicaoParaStatus[];
}) {
  const automatico = estagioAutomatico(os);
  const exibido = os.statusManual ? estagioDoStatus(os.status, os.medicoes) : automatico;
  return {
    automatico,
    exibido,
    manual: os.statusManual,
    /** Ajuste manual que DIVERGE do que os fatos dizem — a tela avisa. */
    divergente: os.statusManual && !statusCorresponde(os.status, automatico),
  };
}
