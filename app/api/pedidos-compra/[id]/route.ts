import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { pedidoCompraEdicaoSchema } from "@/lib/validations";
import { mudancasPedido, pedidoEditavel, podeEditarPedido, podeVerPedido, type PedidoComparavel } from "@/lib/compras/pedido";
import { carregarPedido, compradorValido, pedidoParaTela, registrarEventoPedido } from "@/lib/compras/pedido-server";
import { chaveDiaCivil, diaCivilDeChave } from "@/lib/fuso";

type Params = { params: Promise<{ id: string }> };

const semPermissao = () => NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const u = session.user!;
  const pedido = await carregarPedido(id, u.empresaId);
  if (!pedido) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  if (!podeVerPedido(u, pedido)) return semPermissao();
  return NextResponse.json(pedidoParaTela(pedido, u));
}

/**
 * Edição inline do pedido (itens, prazo, comprador, fornecedor, observação, motivo do avulso) até concluir
 * ou cancelar. Cada mudança vai para o histórico. Itens com `id` deste pedido são atualizados (o custo
 * real fica), os sem `id` entram, os que sumiram saem.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const u = session.user!;
  const empresaId = u.empresaId;

  const pedido = await carregarPedido(id, empresaId);
  if (!pedido) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  if (!podeEditarPedido(u, pedido)) return semPermissao();
  if (!pedidoEditavel(pedido.status)) {
    return NextResponse.json({ erro: "Pedido concluído ou cancelado não pode mais ser editado." }, { status: 409 });
  }

  const parsed = pedidoCompraEdicaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const compradorId = d.compradorId || null;
  const fornecedorId = d.fornecedorId || null;

  // Produto/fornecedor: da empresa; novo precisa estar ativo (o que já estava no pedido pode ficar)
  try {
    await validarRefsEmpresa("produto", d.itens.map((it) => it.produtoId), empresaId, "Produto", { novoAtivo: true, manter: pedido.itens.map((i) => i.produtoId) });
    await validarRefEmpresa("fornecedor", fornecedorId, empresaId, "Fornecedor", { novoAtivo: true, manter: [pedido.fornecedorId] });
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  if (compradorId !== pedido.compradorId && !(await compradorValido(empresaId, compradorId))) {
    return NextResponse.json({ erro: "O comprador precisa ser um usuário ativo com acesso a Compras." }, { status: 400 });
  }

  const idsAtuais = new Set(pedido.itens.map((i) => i.id));
  const itens = d.itens.map((it) => ({ ...it, id: it.id && idsAtuais.has(it.id) ? it.id : null }));
  const avulso = !pedido.ordemServicoId && !pedido.orcamentoId;
  const motivo = avulso ? d.motivo?.trim() || pedido.motivo : pedido.motivo;
  const prazo = diaCivilDeChave(d.prazoNecessario);

  const [comprador, fornecedor] = await Promise.all([
    compradorId ? prisma.usuario.findFirst({ where: { id: compradorId, empresaId }, select: { nome: true } }) : null,
    fornecedorId ? prisma.fornecedor.findFirst({ where: { id: fornecedorId, empresaId }, select: { nome: true } }) : null,
  ]);
  const antes: PedidoComparavel = {
    prazoNecessario: pedido.prazoNecessario ? chaveDiaCivil(pedido.prazoNecessario) : null,
    compradorNome: pedido.comprador?.nome ?? null, fornecedorNome: pedido.fornecedor?.nome ?? null,
    observacao: pedido.observacao, motivo: pedido.motivo,
    itens: pedido.itens.map((i) => ({ id: i.id, produtoId: i.produtoId, descricao: i.descricao, quantidade: Number(i.quantidade), unidade: i.unidade })),
  };
  const depois: PedidoComparavel = {
    prazoNecessario: prazo ? chaveDiaCivil(prazo) : null,
    compradorNome: comprador?.nome ?? null, fornecedorNome: fornecedor?.nome ?? null,
    observacao: d.observacao?.trim() || null, motivo,
    itens: itens.map((i) => ({ id: i.id, produtoId: i.produtoId || null, descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade })),
  };
  const mudancas = mudancasPedido(antes, depois);

  await prisma.$transaction(async (tx) => {
    const manter = itens.filter((i) => i.id).map((i) => i.id!);
    await tx.pedidoCompraItem.deleteMany({ where: { pedidoId: id, id: { notIn: manter } } });
    for (const it of itens) {
      const campos = {
        produtoId: it.produtoId || null, descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidade,
        valorEstimado: it.valorEstimado ?? null, observacao: it.observacao ?? null,
      };
      if (it.id) await tx.pedidoCompraItem.update({ where: { id: it.id }, data: campos });
      else await tx.pedidoCompraItem.create({ data: { pedidoId: id, ...campos } });
    }
    await tx.pedidoCompraInterno.update({
      where: { id },
      data: { compradorId, fornecedorId, prazoNecessario: prazo, observacao: depois.observacao, motivo },
    });
    if (mudancas.length) {
      await registrarEventoPedido({ empresaId, pedidoId: id, tipo: "EDITADO", detalhe: mudancas.join("\n"), usuarioId: u.id }, tx);
    }
  });

  const atualizado = await carregarPedido(id, empresaId);
  return NextResponse.json({ ...pedidoParaTela(atualizado!, u), mudancas });
}
