/**
 * A CHEGADA do técnico, vista pelo card da OS (Meu dia / Agenda) e pela entrada da OS. Módulo PURO.
 *
 * O "A caminho" e o "Cheguei" são os mesmos toques de antes (lib/tecnico/aviso-cliente: um por evento,
 * por dia; horário registrado; aviso ao cliente se houver sinal). O que este módulo decide é ONDE o
 * card está e se a OS abre:
 *
 *   antes         — agendada, nenhum toque hoje: o card só se lê (expande); a OS não abre
 *   a-caminho     — tocou "A caminho" hoje: idem, falta o "Cheguei"
 *   chegou        — tocou "Cheguei" hoje: a OS abre (ainda "Agendada" até a 1ª gravação)
 *   em-andamento  — já tem gravação (de hoje ou de outro dia): a OS abre direto, sem "Cheguei" de novo
 *   concluida / cancelada — abre para leitura
 *
 * A trava vale para a atividade AGENDADA: é o "Cheguei" de HOJE que abre a porta.
 */
import { aplicarToque, avisoDoDia, juntarAvisos, type AvisoClienteRetrato, type AvisosTela } from "@/lib/tecnico/aviso-cliente";
import type { CartaoTela, OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

export type EstadoCartao = "antes" | "a-caminho" | "chegou" | "em-andamento" | "concluida" | "cancelada";

/** O que o retrato da OS guardado no aparelho sabe (é o mesmo que a tela da OS usa para abrir). */
export interface Guardado {
  status: string;
  avisos?: AvisosTela;
  /** Empresa e WhatsApp do cliente para o toque manual; null = "Avisar o cliente" desligado */
  avisoCliente?: AvisoClienteRetrato | null;
  /** Quando o retrato foi guardado (relógio do aparelho) */
  salvoEm: number;
}

/** O que o card aproveita de um retrato guardado. */
export function guardadoDoRetrato(r: RetratoAtividade, salvoEm: number): Guardado {
  return { status: r.execucao.atividade.status, avisos: r.execucao.avisos, avisoCliente: r.avisoCliente, salvoEm };
}

/** A execução da OS abre? Agendada só depois do "Cheguei" de hoje; qualquer outra situação, sim. */
export function podeEntrar(status: string, avisos: AvisosTela | null | undefined, agora: number = Date.now()): boolean {
  return status !== "AGENDADA" || !!avisoDoDia(avisos, "CHEGOU", agora);
}

export function estadoDoCartao(status: string, avisos: AvisosTela | null | undefined, agora: number = Date.now()): EstadoCartao {
  if (status === "CONCLUIDA") return "concluida";
  if (status === "CANCELADA") return "cancelada";
  if (status !== "AGENDADA") return "em-andamento";
  if (avisoDoDia(avisos, "CHEGOU", agora)) return "chegou";
  return avisoDoDia(avisos, "A_CAMINHO", agora) ? "a-caminho" : "antes";
}

/**
 * A situação do card: o que a lista baixou + o retrato guardado da OS (se for mais novo que a lista)
 * + o que o técnico gravou no aparelho e ainda não está em nenhum dos dois.
 *  - situação: iniciar/concluir ainda a enviar já contam;
 *  - toques de hoje: a lista, o retrato e a fila (inclusive o que já subiu e espera o retrato novo).
 */
export function situacaoDoCartao(
  c: CartaoTela, fila: OperacaoFila[],
  op: { guardado?: Guardado | null; /** quando a lista foi baixada */ listaEm?: number | null; agora?: number } = {},
) {
  const agora = op.agora ?? Date.now();
  const g = op.guardado ?? null;
  const minhas = fila.filter((o) => o.atividadeId === c.atividadeId).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const aEnviar = minhas.filter((o) => o.estado !== "enviada");
  const base = g && g.salvoEm > (op.listaEm ?? 0) ? g.status : c.status;
  const status = aEnviar.some((o) => o.tipo === "concluir") ? "CONCLUIDA" : aEnviar.some((o) => o.tipo === "iniciar") && base === "AGENDADA" ? "EM_ANDAMENTO" : base;
  let avisos = juntarAvisos(c.avisos, g?.avisos);
  for (const o of minhas) if (o.tipo === "avisoCliente") avisos = aplicarToque(avisos, o.dados.evento, o.em ?? o.criadoEm);
  const estado = estadoDoCartao(status, avisos, agora);
  return {
    status, aEnviar: aEnviar.length, avisos, estado,
    /** A OS abre ao tocar no card? */
    entra: estado !== "antes" && estado !== "a-caminho",
    aCaminho: avisoDoDia(avisos, "A_CAMINHO", agora),
    chegou: avisoDoDia(avisos, "CHEGOU", agora),
  };
}
