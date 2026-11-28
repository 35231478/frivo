import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { liberarSemPedido } from "@/lib/pedido-cliente/server";
import { ids, MSG_SEM_PERMISSAO_LIBERAR, podeLiberarSemPedido } from "@/lib/pedido-cliente/acesso";

/**
 * LIBERAR SEM PEDIDO DO CLIENTE: a fatura, a NFS-e (e, no modo "para executar", o início) seguem sem o pedido.
 * Só com a permissão própria (o administrador sempre); o motivo vai para a trilha da OS/orçamento.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!podeLiberarSemPedido(session)) return NextResponse.json({ erro: MSG_SEM_PERMISSAO_LIBERAR }, { status: 403 });
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const r = await liberarSemPedido({ empresaId: session.user.empresaId, usuarioId: session.user.id }, { osIds: ids(corpo.osIds), orcamentoIds: ids(corpo.orcamentoIds) }, corpo.motivo);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r);
}
