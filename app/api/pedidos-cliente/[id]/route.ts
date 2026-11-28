import { NextRequest, NextResponse } from "next/server";
import { MSG_FORA_DO_ESCOPO, pedidoForaDoEscopo } from "@/lib/escopo/proprios-server";
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
  // COM-1: "Ver só os próprios" — pedido que cobre OS/orçamento de outro vendedor não existe para a pessoa
  if (await pedidoForaDoEscopo(session.user, id)) return NextResponse.json({ erro: MSG_FORA_DO_ESCOPO }, { status: 404 });
  const p = await prisma.pedidoCliente.findFirst({
    where: { id, empresaId: session.user.empresaId },
    select: {
      id: true, numero: true, data: true, valor: true, observacao: true, anexoNome: true, anexoTipo: true, criadoEm: true,
      // PC-2: o pedido de compra que veio do portal (a conferência)
      origem: true, situacao: true, motivoRecusa: true, conferidoEm: true, osPropostas: true, orcamentosPropostos: true, enviadoPorContatoId: true,
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      ordens: { select: { id: true, numero: true }, orderBy: { numero: "asc" } },
      orcamentos: { select: { id: true, codigo: true }, orderBy: { codigo: "asc" } },
    },
  });
  if (!p) return NextResponse.json({ erro: "Pedido do cliente não encontrado." }, { status: 404 });
  const valor = p.valor === null ? null : Number(p.valor);
  // Em conferência, o que ele "cobre" é o que o comprador propôs (ainda não ligado); do mesmo cliente, sempre
  const conferindo = p.situacao === "CONFERIR";
  const [propostasOs, propostosOrc, contato] = await Promise.all([
    conferindo && p.osPropostas.length ? prisma.ordemServico.findMany({ where: { id: { in: p.osPropostas }, empresaId: session.user.empresaId, clienteId: p.cliente.id }, select: { id: true, numero: true }, orderBy: { numero: "asc" } }) : [],
    conferindo && p.orcamentosPropostos.length ? prisma.orcamento.findMany({ where: { id: { in: p.orcamentosPropostos }, empresaId: session.user.empresaId, clienteId: p.cliente.id }, select: { id: true, codigo: true }, orderBy: { codigo: "asc" } }) : [],
    p.enviadoPorContatoId ? prisma.contatoCliente.findFirst({ where: { id: p.enviadoPorContatoId, empresaId: session.user.empresaId }, select: { nome: true, email: true } }) : null,
  ]);
  const ordens = conferindo ? propostasOs : p.ordens;
  const orcamentos = conferindo ? propostosOrc : p.orcamentos;
  const total = await totalLigado(ordens.map((o) => o.id), orcamentos.map((o) => o.id));
  const { osPropostas: _o, orcamentosPropostos: _c, enviadoPorContatoId: _e, ...resto } = p;
  return NextResponse.json({
    ...resto, ordens, orcamentos, valor, data: p.data.toISOString().slice(0, 10), temAnexo: !!p.anexoNome, total,
    cliente: p.cliente.nomeFantasia ?? p.cliente.nome, alerta: alertaValorPedido(valor, total),
    enviadoPor: contato ? [contato.nome, contato.email].filter(Boolean).join(" · ") : null,
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
  // COM-1: "Ver só os próprios" — pedido que cobre OS/orçamento de outro vendedor não existe para a pessoa
  if (await pedidoForaDoEscopo(session.user, id)) return NextResponse.json({ erro: MSG_FORA_DO_ESCOPO }, { status: 404 });
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const r = await editarPedido({ empresaId: session.user.empresaId, usuarioId: session.user.id }, id, corpo);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r);
}
