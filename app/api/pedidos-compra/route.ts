import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pedidoCompraSchema } from "@/lib/validations";
import { gerarNumeroPedidoCompra, formatarData, whatsappLink } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const ordemServicoId = searchParams.get("ordemServicoId");
  const orcamentoId = searchParams.get("orcamentoId");
  const compradorId = searchParams.get("compradorId");

  const where: any = { empresaId };
  if (status) where.status = status;
  if (ordemServicoId) where.ordemServicoId = ordemServicoId;
  if (orcamentoId) where.orcamentoId = orcamentoId;
  if (compradorId) where.compradorId = compradorId;

  const pedidos = await prisma.pedidoCompraInterno.findMany({
    where,
    include: {
      itens: true,
      comprador: { select: { id: true, nome: true } },
      solicitante: { select: { id: true, nome: true } },
      ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
    },
    orderBy: { criadoEm: "desc" },
    take: 200,
  });

  return NextResponse.json(pedidos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const solicitanteId = session.user!.id;

  const parsed = pedidoCompraSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const seq = (await prisma.pedidoCompraInterno.count({ where: { empresaId } })) + 1;
  const numero = gerarNumeroPedidoCompra(seq);

  const pedido = await prisma.pedidoCompraInterno.create({
    data: {
      empresaId,
      numero,
      ordemServicoId: data.ordemServicoId || null,
      orcamentoId: data.orcamentoId || null,
      solicitanteId,
      compradorId: data.compradorId || null,
      status: "SOLICITADO",
      prazoNecessario: data.prazoNecessario ? new Date(data.prazoNecessario) : null,
      observacao: data.observacao ?? null,
      itens: {
        create: data.itens.map((it) => ({
          produtoId: it.produtoId || null,
          descricao: it.descricao,
          quantidade: it.quantidade,
          unidade: it.unidade,
          valorEstimado: it.valorEstimado ?? null,
          fornecedor: it.fornecedor ?? null,
          observacao: it.observacao ?? null,
        })),
      },
    },
    include: {
      itens: true,
      comprador: { select: { id: true, nome: true, telefone: true } },
      ordemServico: { select: { numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
    },
  });

  // Monta mensagem de WhatsApp para o comprador
  const origin = req.nextUrl.origin;
  const link = `${origin}/compras/pedidos/${pedido.id}`;
  const osNumero = pedido.ordemServico?.numero ?? "—";
  const clienteNome = pedido.ordemServico?.cliente
    ? (pedido.ordemServico.cliente.nomeFantasia ?? pedido.ordemServico.cliente.nome)
    : "—";
  const itensTxt = pedido.itens
    .map((i) => `📦 ${i.descricao} — ${Number(i.quantidade)} ${i.unidade}`)
    .join("\n");
  const prazoTxt = pedido.prazoNecessario ? formatarData(pedido.prazoNecessario) : "—";
  const mensagem =
    `🛒 *Pedido de Compra #${pedido.numero}*\n` +
    `📋 OS: ${osNumero} — ${clienteNome}\n` +
    `${itensTxt}\n` +
    `⏰ Prazo: ${prazoTxt}\n` +
    (pedido.observacao ? `💬 ${pedido.observacao}\n` : "") +
    `🔗 Ver detalhes: ${link}`;

  const whatsappUrl = pedido.comprador?.telefone ? whatsappLink(pedido.comprador.telefone, mensagem) : null;

  return NextResponse.json({ ...pedido, whatsappUrl, mensagem }, { status: 201 });
}
