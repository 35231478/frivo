import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode, type Permissoes } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { pedidoCompraStatusSchema } from "@/lib/validations";
import { LABELS_STATUS_PEDIDO_COMPRA, whatsappLink } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

/** Quem pode ver/mexer: financeiro, quem vê a OS/orçamento de origem, ou o comprador designado. */
function podeVerPedido(
  user: { id: string; role?: string; permissoes?: unknown },
  pedido: { ordemServicoId: string | null; orcamentoId: string | null; compradorId: string | null },
) {
  const p = user.permissoes as Permissoes;
  return pode(p, "financeiro", "visualizar", user.role)
    || pedido.compradorId === user.id
    || (!!pedido.ordemServicoId && pode(p, "ordens", "visualizar", user.role))
    || (!!pedido.orcamentoId && pode(p, "orcamentos", "visualizar", user.role));
}

const semPermissao = () => NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const pedido = await prisma.pedidoCompraInterno.findFirst({
    where: { id, empresaId },
    include: {
      itens: { include: { produto: { select: { id: true, nome: true } } } },
      comprador: { select: { id: true, nome: true, telefone: true } },
      solicitante: { select: { id: true, nome: true } },
      ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
      orcamento: { select: { id: true, codigo: true } },
    },
  });
  if (!pedido) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  if (!podeVerPedido(session.user!, pedido)) return semPermissao();
  return NextResponse.json(pedido);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const pedido = await prisma.pedidoCompraInterno.findFirst({
    where: { id, empresaId },
    include: { ordemServico: { include: { responsavel: { select: { nome: true, telefone: true } } } } },
  });
  if (!pedido) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  // Andar com o status (cotação/compra/entrega): o comprador designado ou o financeiro
  const u = session.user!;
  if (pedido.compradorId !== u.id && !pode(u.permissoes as Permissoes, "financeiro", "visualizar", u.role)) {
    return semPermissao();
  }

  const parsed = pedidoCompraStatusSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const novo = parsed.data.status;

  await prisma.pedidoCompraInterno.update({ where: { id }, data: { status: novo } });

  const origin = req.nextUrl.origin;
  const link = `${origin}/compras/pedidos/${id}`;
  const statusLabel = LABELS_STATUS_PEDIDO_COMPRA[novo];

  // Notifica o gestor a cada mudança de status
  const gestor = await prisma.usuario.findFirst({
    where: { empresaId, ativo: true, role: { in: ["GERENTE", "ADMIN"] }, telefone: { not: null } },
    select: { nome: true, telefone: true },
  });
  const msgGestor =
    `📦 *Pedido ${pedido.numero}* mudou para *${statusLabel}*.\n🔗 ${link}`;
  const whatsappGestor = gestor?.telefone ? whatsappLink(gestor.telefone, msgGestor) : null;

  // Quando ENTREGUE, notifica o técnico responsável da OS
  let whatsappTecnico: string | null = null;
  if (novo === "ENTREGUE" && pedido.ordemServico?.responsavel?.telefone) {
    const msgTec =
      `✅ Material do pedido *${pedido.numero}* foi *entregue* (OS ${pedido.ordemServico.numero}).\n🔗 ${link}`;
    whatsappTecnico = whatsappLink(pedido.ordemServico.responsavel.telefone, msgTec);
  }

  return NextResponse.json({ ok: true, status: novo, whatsappGestor, whatsappTecnico });
}
