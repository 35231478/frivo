/**
 * O ESTADO VISÍVEL da atividade — a regra pura (sem banco, sem React).
 *
 * O banco guarda quatro status (AGENDADA, EM_ANDAMENTO, CONCLUIDA, CANCELADA). O técnico, no app,
 * toca "A caminho" e "Cheguei": isso vai para `atividade_avisos` (um por atividade, evento e DIA,
 * lib/tecnico/aviso-cliente) e NÃO muda o status — o status só vira EM_ANDAMENTO quando a execução
 * começa (o app inicia a atividade ao abrir a OS, logo depois do "Cheguei").
 *
 * "Em deslocamento" é um estado DERIVADO do que já é gravado, sem status novo no banco: a atividade
 * ainda AGENDADA cujo técnico tocou "A caminho" HOJE (dia de Brasília) e ainda não tocou "Cheguei".
 * Ao "Cheguei" / iniciar, o estado volta a ser o de sempre ("Em andamento"). Um "A caminho" de ontem
 * não vale hoje: o toque é do dia, como o aviso ao cliente.
 *
 * O mesmo vocabulário e o mesmo tom em todo lugar: painel de Atividades da OS, calendário, app do
 * técnico. "Em deslocamento" tem tom próprio no sistema de design (`status.deslocamento`).
 */
import { chaveDiaBR } from "@/lib/fuso";

export type StatusAtividade = "AGENDADA" | "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA";
/** O que a tela mostra: os quatro status gravados mais o derivado */
export type EstadoAtividade = StatusAtividade | "EM_DESLOCAMENTO";

/** Um toque gravado em `atividade_avisos` (só o que a derivação precisa) */
export interface AvisoDaAtividade {
  evento: string;
  /** Horário do toque (o `dia` da linha é derivado dele, em Brasília) */
  registradoEm: Date | string;
}

export interface AtividadeComAvisos {
  status: string;
  avisosCliente?: AvisoDaAtividade[] | null;
}

/** O técnico tocou este evento HOJE (dia civil de Brasília)? */
export function tocouHoje(avisos: AvisoDaAtividade[] | null | undefined, evento: "A_CAMINHO" | "CHEGOU", agora: Date = new Date()): boolean {
  const hoje = chaveDiaBR(agora);
  return (avisos ?? []).some((a) => a.evento === evento && chaveDiaBR(a.registradoEm) === hoje);
}

/**
 * O estado visível: o status gravado, exceto a AGENDADA com "A caminho" de hoje e sem "Cheguei" de
 * hoje, que é "Em deslocamento". Status que não é AGENDADA nunca muda (já está em andamento, concluída
 * ou cancelada); com o "Cheguei" registrado a atividade já não está a caminho.
 */
export function estadoVisivelDaAtividade(a: AtividadeComAvisos, agora: Date = new Date()): EstadoAtividade {
  if (a.status !== "AGENDADA") return a.status as EstadoAtividade;
  if (tocouHoje(a.avisosCliente, "CHEGOU", agora)) return "AGENDADA";
  return tocouHoje(a.avisosCliente, "A_CAMINHO", agora) ? "EM_DESLOCAMENTO" : "AGENDADA";
}

export const ROTULO_ESTADO_ATIVIDADE: Record<EstadoAtividade, string> = {
  AGENDADA: "Agendada", EM_DESLOCAMENTO: "Em deslocamento", EM_ANDAMENTO: "Em andamento", CONCLUIDA: "Concluída", CANCELADA: "Cancelada",
};

/** O tom do sistema de design de cada estado (components/ui/status-pill) */
export const TOM_ESTADO_ATIVIDADE: Record<EstadoAtividade, "acento" | "deslocamento" | "atencao" | "ok" | "atrasado"> = {
  AGENDADA: "acento", EM_DESLOCAMENTO: "deslocamento", EM_ANDAMENTO: "atencao", CONCLUIDA: "ok", CANCELADA: "atrasado",
};
