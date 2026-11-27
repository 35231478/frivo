import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { editarPedido, totalLigado } from "@/lib/pedido-cliente/server";
import { alertaValorPedido } from "@/lib/pedido-cliente/regra";
import { MSG_SEM_PERMISSAO_PEDIDO, podeInformarPedido } from "@/lib/pedido-cliente/acesso";

type Params = { params: Promise<{ id: string }> };

/** O pedido do cliente: os dados, o anexo (se há) e o que ele cobre — para a gaveta da OS/orçamento */
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const p = await prisma.pedidoCliente.findFirst({
    where: { id, empresaId: session.user.empresaId },
    select: {
      id: true, numero: true, data: true, valor: true, observacao: true, anexoNome: true, anexoTipo: true, criadoEm: true,
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      ordens: { select: { id: true, numero: true }, orderBy: { numero: "asc" } },
      orcamentos: { select: { id: true, codigo: true }, orderBy: { codigo: "asc" } },
    },
  });
  if (!p) return NextResponse.json({ erro: "Pedido do cliente não encontrado." }, { status: 404 });
  const valor = p.valor === null ? null : Number(p.valor);
  const total = await totalLigado(p.ordens.map((o) => o.id), p.orcamentos.map((o) => o.id));
  return NextResponse.json({
    ...p, valor, data: p.data.toISOString().slice(0, 10), temAnexo: !!p.anexoNome, total,
    cliente: p.cliente.nomeFantasia ?? p.cliente.nome, alerta: alertaValorPedido(valor, total),
  });
}

/** Corrigir o pedido (número, data, valor, observação, anexo); as OS e orçamentos que ele cobre ficam */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!podeInformarPedido(session, { os: true, orcamentos: false }) && !podeInformarPedido(session, { os: false, orcamentos: true })) {
    return NextResponse.json({ erro: MSG_SEM_PERMISSAO_PEDIDO }, { status: 403 });
  }
  const { id } = await params;
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const r = await editarPedido({ empresaId: session.user.empresaId, usuarioId: session.user.id }, id, corpo);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r);
}
