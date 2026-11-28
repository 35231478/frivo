import type { Session } from "next-auth";
import { pode } from "@/lib/permissoes";

/**
 * Quem informa o pedido do cliente: para OS, quem edita OS ou lança faturas (Financeiro › Medições); para
 * orçamento, quem edita orçamentos ou lança faturas. Liberar sem pedido é a permissão própria (Ordens de serviço ›
 * Liberar sem pedido do cliente; o administrador sempre).
 */
export function podeInformarPedido(session: Session, alvo: { os: boolean; orcamentos: boolean }) {
  const { permissoes, role } = session.user;
  const fatura = pode(permissoes, "financeiro", "medicoes", role);
  return (!alvo.os || fatura || pode(permissoes, "ordens", "editar", role)) && (!alvo.orcamentos || fatura || pode(permissoes, "orcamentos", "editar", role));
}
export const podeLiberarSemPedido = (session: Session) => pode(session.user.permissoes, "ordens", "liberarSemPedido", session.user.role);
export const MSG_SEM_PERMISSAO_PEDIDO = "Sem permissão para informar o pedido do cliente.";
export const MSG_SEM_PERMISSAO_LIBERAR = "Sem permissão para liberar sem pedido do cliente.";

/** Os ids do corpo (até 500 de cada) */
export const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64).slice(0, 500) : []);
