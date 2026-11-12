import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pedidoCompraEnvioSchema } from "@/lib/validations";
import { formatarData, whatsappLink } from "@/lib/utils";
import { emailConfigAtiva, enviarPedidoCompra } from "@/lib/email";
import { LABEL_STATUS_PEDIDO, mensagemFornecedor, pedidoEncerrado, podeEnviarPedido, statusAposEnvio, type StatusPedido } from "@/lib/compras/pedido";
import { carregarPedido, registrarEventoPedido } from "@/lib/compras/pedido-server";

/**
 * Baixar o PDF ou enviar o PC ao fornecedor do cadastro (e-mail pelo Resend da empresa, ou WhatsApp).
 * Quem tem Compras ou o comprador designado. Cada um vai para o histórico, e o pedido "Solicitado"
 * passa a "Em cotação". Sem contato no cadastro: avisa e não muda nada.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const u = session.user!;
  const empresaId = u.empresaId;
  const pedido = await carregarPedido(id, empresaId);
  if (!pedido) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  if (!podeEnviarPedido(u, pedido)) return NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });
  const corpo = pedidoCompraEnvioSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return NextResponse.json({ erro: "Canal de envio inválido." }, { status: 400 });
  const { canal } = corpo.data;
  if (canal !== "BAIXAR" && pedidoEncerrado(pedido.status)) {
    return NextResponse.json({ erro: `Pedido ${LABEL_STATUS_PEDIDO[pedido.status as StatusPedido].toLowerCase()}: não dá mais para enviar ao fornecedor.` }, { status: 409 });
  }

  const origem = req.nextUrl.origin;
  const publicUrl = `${origem}/pedido-compra/${pedido.tokenPublico}`;
  const pdfUrl = `/pedido-compra/${pedido.tokenPublico}?imprimir=1`;
  const f = pedido.fornecedor;
  let detalhe: string | null = null;
  let tipo: string;
  let whatsappUrl: string | null = null;
  let mailtoUrl: string | null = null;
  let emailEnviado = false;

  if (canal === "BAIXAR") {
    tipo = "BAIXADO";
  } else if (canal === "EMAIL") {
    if (!f) return NextResponse.json({ erro: "Escolha o fornecedor do pedido para enviar por e-mail." }, { status: 400 });
    if (!f.email?.trim()) return NextResponse.json({ erro: `O fornecedor ${f.nome} não tem e-mail no cadastro.` }, { status: 400 });
    tipo = "ENVIADO_EMAIL";
    if (await emailConfigAtiva(empresaId)) {
      const r = await enviarPedidoCompra(id).catch(() => ({ ok: false, erro: "Erro no envio." } as { ok: boolean; erro?: string }));
      if (!r.ok) return NextResponse.json({ erro: r.erro ?? "Não foi possível enviar o e-mail." }, { status: 502 });
      emailEnviado = true;
      detalhe = `${f.nome} · ${f.email}`;
    } else {
      // Sem o Resend configurado: abre o e-mail do usuário, já com o link do PC
      const assunto = `Pedido de Compra ${pedido.numero} — ${u.empresaNome ?? ""}`.trim();
      const texto = `Olá, ${f.nome}!\n\nSegue o Pedido de Compra ${pedido.numero} para cotação${pedido.prazoNecessario ? ` (necessário até ${formatarData(pedido.prazoNecessario)})` : ""}:\n${publicUrl}\n\nPor favor, informe preço, validade e prazo de entrega de cada item.`;
      mailtoUrl = `mailto:${encodeURIComponent(f.email.trim())}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`;
      detalhe = `pelo e-mail do usuário, para ${f.email}`;
    }
  } else {
    if (!f) return NextResponse.json({ erro: "Escolha o fornecedor do pedido para enviar por WhatsApp." }, { status: 400 });
    if (!f.telefone?.trim()) return NextResponse.json({ erro: `O fornecedor ${f.nome} não tem telefone no cadastro.` }, { status: 400 });
    tipo = "ENVIADO_WHATSAPP";
    whatsappUrl = whatsappLink(f.telefone, mensagemFornecedor({
      numero: pedido.numero, empresa: u.empresaNome ?? "", contato: null,
      prazo: pedido.prazoNecessario ? formatarData(pedido.prazoNecessario) : null, link: publicUrl,
    }));
    detalhe = `${f.nome} · ${f.telefone}`;
  }

  const novo = statusAposEnvio(pedido.status);
  await prisma.$transaction(async (tx) => {
    await registrarEventoPedido({ empresaId, pedidoId: id, tipo, detalhe, usuarioId: u.id }, tx);
    if (novo !== pedido.status) {
      await tx.pedidoCompraInterno.update({ where: { id }, data: { status: novo as StatusPedido, statusEm: new Date() } });
      await registrarEventoPedido({
        empresaId, pedidoId: id, tipo: "STATUS", usuarioId: u.id,
        detalhe: `${LABEL_STATUS_PEDIDO[pedido.status as StatusPedido]} → ${LABEL_STATUS_PEDIDO[novo as StatusPedido]}`,
      }, tx);
    }
  });

  return NextResponse.json({ ok: true, status: novo, pdfUrl, publicUrl, whatsappUrl, mailtoUrl, emailEnviado });
}
