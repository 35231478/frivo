import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { registrarPedido } from "@/lib/pedido-cliente/server";
import { ids, MSG_SEM_PERMISSAO_PEDIDO, podeInformarPedido } from "@/lib/pedido-cliente/acesso";

/**
 * INFORMAR O PEDIDO DO CLIENTE para uma ou várias OS e orçamentos do MESMO cliente (a gaveta da etiqueta
 * "Aguardando pedido" e a ação em massa das listas). Corpo: { numero, data?, valor?, observacao?, anexo?, osIds, orcamentoIds }.
 * Devolve o alerta quando o valor do pedido é menor que o total do que ele cobre (não trava).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const osIds = ids(corpo.osIds), orcamentoIds = ids(corpo.orcamentoIds);
  if (!podeInformarPedido(session, { os: osIds.length > 0, orcamentos: orcamentoIds.length > 0 })) return NextResponse.json({ erro: MSG_SEM_PERMISSAO_PEDIDO }, { status: 403 });
  const r = await registrarPedido({ empresaId: session.user.empresaId, usuarioId: session.user.id }, corpo, { osIds, orcamentoIds });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r, { status: 201 });
}
