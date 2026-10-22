import { pode, type Permissoes } from "@/lib/permissoes";

/**
 * Quem pode ver/mexer num pedido de compra: financeiro, quem vê a OS/orçamento
 * de origem, ou o comprador designado. Usada pela API e pela tela de detalhe.
 */
export function podeVerPedido(
  user: { id: string; role?: string; permissoes?: unknown },
  pedido: { ordemServicoId: string | null; orcamentoId: string | null; compradorId: string | null },
): boolean {
  const p = user.permissoes as Permissoes;
  return pode(p, "financeiro", "visualizar", user.role)
    || pedido.compradorId === user.id
    || (!!pedido.ordemServicoId && pode(p, "ordens", "visualizar", user.role))
    || (!!pedido.orcamentoId && pode(p, "orcamentos", "visualizar", user.role));
}
