import { NextRequest, NextResponse } from "next/server";
import { idsNoEscopo } from "@/lib/escopo/proprios-server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SELECT_PEDIDO_ORCAMENTO, SELECT_PEDIDO_OS, situacaoDaOs, situacaoDoOrcamento, totalLigado, valoresDasOs } from "@/lib/pedido-cliente/server";
import { aguardandoPedido } from "@/lib/pedido-cliente/regra";
import { podeLiberarSemPedido } from "@/lib/pedido-cliente/acesso";

const lista = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter((x) => x && x.length <= 64).slice(0, 500);

/**
 * O que a gaveta do pedido vai cobrir (?os=id,id&orc=id): número, cliente, valor e a situação de cada um, o total,
 * se são todos do mesmo cliente e se quem pergunta pode liberar sem pedido.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user.empresaId;
  let osIds = lista(req.nextUrl.searchParams.get("os"));
  let orcIds = lista(req.nextUrl.searchParams.get("orc"));
  // A fatura (medição): as OS e orçamentos dela
  const medicaoId = req.nextUrl.searchParams.get("med");
  let clienteDaFatura: { nome: string; nomeFantasia: string | null; comprasNome: string | null; comprasEmail: string | null; comprasTelefone: string | null } | null = null;
  if (medicaoId) {
    const m = await prisma.medicao.findFirst({
      where: { id: medicaoId, empresaId },
      select: { itens: { select: { ordemServicoId: true, orcamentoId: true } }, cliente: { select: { nome: true, nomeFantasia: true, comprasNome: true, comprasEmail: true, comprasTelefone: true } } },
    });
    if (!m) return NextResponse.json({ erro: "Fatura não encontrada." }, { status: 404 });
    clienteDaFatura = m.cliente;
    for (const i of m.itens) { if (i.ordemServicoId && !osIds.includes(i.ordemServicoId)) osIds.push(i.ordemServicoId); if (i.orcamentoId && !orcIds.includes(i.orcamentoId)) orcIds.push(i.orcamentoId); }
  }
  // COM-1: "Ver só os próprios" — fica só o que é da pessoa (sem a marca, a lista não muda)
  [osIds, orcIds] = await Promise.all([idsNoEscopo(session.user, "ordens", osIds), idsNoEscopo(session.user, "orcamentos", orcIds)]);
  const pedido = { select: { id: true, numero: true } };
  const cliente = { select: { id: true, nome: true, nomeFantasia: true, comprasNome: true, comprasEmail: true, comprasTelefone: true } };
  const [oss, orcs, valores] = await Promise.all([
    osIds.length ? prisma.ordemServico.findMany({ where: { id: { in: osIds }, empresaId }, select: { ...SELECT_PEDIDO_OS, numero: true, chamadoNumero: true, clienteId: true, pedidoCliente: pedido, cliente: { select: { ...cliente.select, exigePcAntesNf: true, exigePedidoExecutar: true } } } }) : [],
    orcIds.length ? prisma.orcamento.findMany({ where: { id: { in: orcIds }, empresaId }, select: { ...SELECT_PEDIDO_ORCAMENTO, codigo: true, clienteId: true, totalGeral: true, pedidoCliente: pedido, cliente: { select: { ...cliente.select, exigePcAntesNf: true, exigePedidoExecutar: true } } } }) : [],
    valoresDasOs(osIds),
  ]);
  const itens = [
    ...oss.map((o) => ({ tipo: "os" as const, id: o.id, numero: o.chamadoNumero ?? o.numero, clienteId: o.clienteId, valor: valores.get(o.id) ?? 0, aguardando: aguardandoPedido(situacaoDaOs(o)), pedido: o.pedidoCliente, liberado: !!o.pedidoLiberadoEm })),
    ...orcs.map((o) => ({ tipo: "orcamento" as const, id: o.id, numero: o.codigo, clienteId: o.clienteId, valor: Number(o.totalGeral) || 0, aguardando: aguardandoPedido(situacaoDoOrcamento(o)), pedido: o.pedidoCliente, liberado: !!o.pedidoLiberadoEm })),
  ];
  const c = oss[0]?.cliente ?? orcs[0]?.cliente ?? clienteDaFatura;
  return NextResponse.json({
    itens,
    mesmoCliente: new Set(itens.map((i) => i.clienteId)).size <= 1,
    cliente: c ? { nome: c.nomeFantasia ?? c.nome, comprasNome: c.comprasNome, comprasEmail: c.comprasEmail, comprasTelefone: c.comprasTelefone } : null,
    total: await totalLigado(oss.map((o) => o.id), orcs.map((o) => o.id)),
    podeLiberar: podeLiberarSemPedido(session),
  });
}
