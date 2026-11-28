import { NextRequest, NextResponse } from "next/server";
import { algumForaDoEscopo, MSG_FORA_DO_ESCOPO } from "@/lib/escopo/proprios-server";
import { auth } from "@/lib/auth";
import { registrarPedido } from "@/lib/pedido-cliente/server";
import { pode } from "@/lib/permissoes";
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
  // A fatura (medição): o "Registrar PC" dela é este mesmo registro — exige lançar faturas (Financeiro › Medições)
  const medicaoId = typeof corpo.medicaoId === "string" && corpo.medicaoId.length <= 64 ? corpo.medicaoId : null;
  const permitido = medicaoId ? podeInformarPedido(session, { os: true, orcamentos: true }) && pode(session.user.permissoes, "financeiro", "medicoes", session.user.role)
    : podeInformarPedido(session, { os: osIds.length > 0, orcamentos: orcamentoIds.length > 0 });
  if (!permitido) return NextResponse.json({ erro: MSG_SEM_PERMISSAO_PEDIDO }, { status: 403 });
  // COM-1: "Ver só os próprios" — OS/orçamento de outro vendedor não existe para a pessoa
  if (await algumForaDoEscopo(session.user, osIds, orcamentoIds)) return NextResponse.json({ erro: MSG_FORA_DO_ESCOPO }, { status: 404 });
  const r = await registrarPedido({ empresaId: session.user.empresaId, usuarioId: session.user.id }, corpo, { osIds, orcamentoIds, medicaoId });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r, { status: 201 });
}
