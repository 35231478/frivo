import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPortalSession } from "@/lib/auth-portal";
import { MSG_TROCA_PENDENTE_PORTAL } from "@/lib/portal/senha-provisoria";
import { conferirBloqueio, ipDaRequisicao, registrarTentativa } from "@/lib/acesso/limite";
import { MSG_SEM_PERMISSAO_PEDIDO_PORTAL, podePedidoNoPortal } from "@/lib/pedido-cliente/lembretes";
import { enviarPedidoPeloPortal } from "@/lib/pedido-cliente/portal-server";
import { ids } from "@/lib/pedido-cliente/acesso";

/**
 * PC-2 — o comprador do cliente ANEXA o pedido de compra no portal (nº, data, valor, arquivo; um pedido cobre
 * vários serviços). O pedido fica "recebido — em conferência" até o escritório confirmar ou recusar.
 * Só o próprio cliente da sessão: o servidor confere cada item (lib/pedido-cliente/portal-server).
 */
export async function POST(req: NextRequest) {
  const sessao = await getPortalSession({ comTroca: true });
  if (!sessao?.user) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (sessao.user.trocarSenha) return NextResponse.json({ erro: MSG_TROCA_PENDENTE_PORTAL }, { status: 403 });
  const { empresaId, clienteId, id: contatoId } = sessao.user;
  const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { comprasEmail: true } });
  if (!cliente || !podePedidoNoPortal(sessao.user, cliente.comprasEmail)) {
    return NextResponse.json({ erro: MSG_SEM_PERMISSAO_PEDIDO_PORTAL }, { status: 403 });
  }
  const alvos = { usuarioId: contatoId, ip: ipDaRequisicao(req.headers) };
  const bloqueio = await conferirBloqueio("PORTAL_PEDIDO_COMPRA", alvos);
  if (bloqueio.bloqueado) return NextResponse.json({ erro: `Muitos envios em sequência. Tente de novo em ${bloqueio.minutos} min.` }, { status: 429 });

  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  await registrarTentativa("PORTAL_PEDIDO_COMPRA", alvos);
  const r = await enviarPedidoPeloPortal(
    { id: contatoId, nome: sessao.user.name, empresaId, clienteId },
    { numero: corpo.numero, data: corpo.data, valor: corpo.valor, observacao: corpo.observacao, anexo: corpo.anexo ?? null },
    { osIds: ids(corpo.osIds), orcamentoIds: ids(corpo.orcamentoIds) },
  );
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r, { status: 201 });
}
