import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { pode, type Permissoes } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { pedidoCompraSchema } from "@/lib/validations";
import { formatarData, whatsappLink } from "@/lib/utils";
import { diaCivilDeChave } from "@/lib/fuso";
import { MOTIVO_AVULSO_PADRAO } from "@/lib/compras/pedido";
import { compradorValido, proximoNumeroPedido, registrarEventoPedido } from "@/lib/compras/pedido-server";

const naoAutorizado = () => NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
const semPermissao = () => NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });

/**
 * Lista de pedidos. Na OS/orçamento: quem vê a OS/orçamento (ou Compras); a lista geral: Compras, ou o
 * financeiro (a conta a pagar escolhe o pedido). Empresa sempre a da sessão.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return naoAutorizado();
  const u = session.user!;
  const p = u.permissoes as Permissoes;
  const sp = new URL(req.url).searchParams;
  const ordemServicoId = sp.get("ordemServicoId");
  const orcamentoId = sp.get("orcamentoId");

  const ok = pode(p, "compras", "visualizar", u.role)
    || (ordemServicoId ? pode(p, "ordens", "visualizar", u.role)
      : orcamentoId ? pode(p, "orcamentos", "visualizar", u.role)
        : pode(p, "financeiro", "visualizar", u.role));
  if (!ok) return semPermissao();

  const where: Prisma.PedidoCompraInternoWhereInput = { empresaId: u.empresaId };
  const status = sp.get("status");
  if (status) where.status = status as Prisma.PedidoCompraInternoWhereInput["status"];
  if (ordemServicoId) where.ordemServicoId = ordemServicoId;
  if (orcamentoId) where.orcamentoId = orcamentoId;
  if (sp.get("compradorId")) where.compradorId = sp.get("compradorId");

  const pedidos = await prisma.pedidoCompraInterno.findMany({
    where,
    include: {
      itens: { orderBy: { id: "asc" } },
      comprador: { select: { id: true, nome: true } },
      solicitante: { select: { id: true, nome: true } },
      fornecedor: { select: { id: true, nome: true } },
      ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
      orcamento: { select: { id: true, codigo: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 200,
  });
  return NextResponse.json(pedidos);
}

/**
 * Novo pedido. Da OS: quem edita a OS; do orçamento: quem edita o orçamento; avulso (reposição de
 * estoque, sem OS/orçamento): Compras › Gerenciar. Compras › Gerenciar também pede em qualquer origem.
 * Número do ano pelo maior sequencial da empresa; o histórico começa com "Pedido criado".
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return naoAutorizado();
  const u = session.user!;
  const p = u.permissoes as Permissoes;
  const parsed = pedidoCompraSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const ordemServicoId = data.ordemServicoId || null;
  const orcamentoId = data.orcamentoId || null;
  const avulso = !ordemServicoId && !orcamentoId;

  const ok = pode(p, "compras", "gerenciar", u.role)
    || (!!ordemServicoId && pode(p, "ordens", "editar", u.role))
    || (!!orcamentoId && pode(p, "orcamentos", "editar", u.role));
  if (!ok) return semPermissao();
  const empresaId = u.empresaId;

  // A OS/orçamento de origem precisa ser da mesma empresa (senão a permissão acima não vale nada)
  if (ordemServicoId && !(await prisma.ordemServico.findFirst({ where: { id: ordemServicoId, empresaId }, select: { id: true } }))) {
    return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  }
  if (orcamentoId && !(await prisma.orcamento.findFirst({ where: { id: orcamentoId, empresaId }, select: { id: true } }))) {
    return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  }

  // Produtos do catálogo e fornecedor: da empresa e ativos (pedido novo = escolha nova)
  try {
    await validarRefsEmpresa("produto", data.itens.map((it) => it.produtoId), empresaId, "Produto", { novoAtivo: true });
    await validarRefEmpresa("fornecedor", data.fornecedorId || null, empresaId, "Fornecedor", { novoAtivo: true });
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  if (!(await compradorValido(empresaId, data.compradorId))) {
    return NextResponse.json({ erro: "O comprador precisa ser um usuário ativo com acesso a Compras." }, { status: 400 });
  }

  const criar = () => prisma.$transaction(async (tx) => {
    const numero = await proximoNumeroPedido(empresaId, undefined, tx);
    const pedido = await tx.pedidoCompraInterno.create({
      data: {
        empresaId, numero, ordemServicoId, orcamentoId, solicitanteId: u.id,
        compradorId: data.compradorId || null,
        fornecedorId: data.fornecedorId || null,
        status: "SOLICITADO",
        motivo: avulso ? data.motivo?.trim() || MOTIVO_AVULSO_PADRAO : null,
        prazoNecessario: diaCivilDeChave(data.prazoNecessario),
        observacao: data.observacao?.trim() || null,
        itens: {
          create: data.itens.map((it) => ({
            produtoId: it.produtoId || null, descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidade,
            valorEstimado: it.valorEstimado ?? null, observacao: it.observacao ?? null,
          })),
        },
      },
      include: {
        itens: true,
        comprador: { select: { id: true, nome: true, telefone: true } },
        ordemServico: { select: { numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
        orcamento: { select: { codigo: true } },
      },
    });
    await registrarEventoPedido({
      empresaId, pedidoId: pedido.id, tipo: "CRIADO", usuarioId: u.id,
      detalhe: `${pedido.itens.length} ${pedido.itens.length === 1 ? "item" : "itens"}${avulso ? ` · ${pedido.motivo}` : ""}`,
    }, tx);
    return pedido;
  });
  // Dois pedidos ao mesmo tempo podem pegar o mesmo número: tenta de novo com o próximo
  let pedido: Awaited<ReturnType<typeof criar>> | null = null;
  for (let tentativa = 0; !pedido; tentativa++) {
    try { pedido = await criar(); }
    catch (e) { if (tentativa >= 2 || !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; }
  }

  // Aviso ao comprador designado (WhatsApp com o link do pedido)
  const link = `${req.nextUrl.origin}/compras/pedidos/${pedido.id}`;
  const origemTxt = pedido.ordemServico
    ? `📋 OS: ${pedido.ordemServico.numero} — ${pedido.ordemServico.cliente.nomeFantasia ?? pedido.ordemServico.cliente.nome}`
    : pedido.orcamento ? `📋 Orçamento: ${pedido.orcamento.codigo}` : `📋 Avulso: ${pedido.motivo}`;
  const mensagem =
    `🛒 *Pedido de Compra ${pedido.numero}*\n${origemTxt}\n` +
    pedido.itens.map((i) => `📦 ${i.descricao} — ${Number(i.quantidade)} ${i.unidade}`).join("\n") + "\n" +
    `⏰ Prazo: ${pedido.prazoNecessario ? formatarData(pedido.prazoNecessario) : "—"}\n` +
    (pedido.observacao ? `💬 ${pedido.observacao}\n` : "") +
    `🔗 Ver detalhes: ${link}`;
  const whatsappUrl = pedido.comprador?.telefone ? whatsappLink(pedido.comprador.telefone, mensagem) : null;

  return NextResponse.json({ ...pedido, whatsappUrl, mensagem }, { status: 201 });
}
