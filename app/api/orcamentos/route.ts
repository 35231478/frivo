import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orcamentoSchema } from "@/lib/validations";
import { gerarCodigoOrcamento } from "@/lib/utils";
import { calcularTotais } from "@/lib/orcamento-helpers";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const clienteId = searchParams.get("clienteId");
  const dataInicio = searchParams.get("dataInicio");
  const dataFim = searchParams.get("dataFim");
  const busca = searchParams.get("busca") ?? "";

  const where: any = { empresaId };
  if (status) where.status = status;
  if (clienteId) where.clienteId = clienteId;
  if (dataInicio || dataFim) {
    where.criadoEm = {};
    if (dataInicio) where.criadoEm.gte = new Date(dataInicio);
    if (dataFim) {
      const fim = new Date(dataFim);
      fim.setHours(23, 59, 59, 999);
      where.criadoEm.lte = fim;
    }
  }
  if (busca) {
    where.OR = [
      { codigo: { contains: busca, mode: "insensitive" } },
      { nome: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const orcamentos = await prisma.orcamento.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      _count: { select: { ordensServico: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 100,
  });

  return NextResponse.json(orcamentos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const body = await req.json();
  const parsed = orcamentoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: "Dados inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const total = await prisma.orcamento.count({ where: { empresaId } });
  const codigo = gerarCodigoOrcamento(total + 1);
  const tokenPublico = crypto.randomUUID();

  const totais = calcularTotais(data.servicos, data.produtos, data.desconto, data.tipoDesconto);

  const orcamento = await prisma.orcamento.create({
    data: {
      empresaId,
      codigo,
      nome: data.nome,
      clienteId: data.clienteId,
      criadoPorId: usuarioId,
      descricao: data.descricao ?? null,
      observacao: data.observacao ?? null,
      validadeEm: data.validadeEm ? new Date(data.validadeEm) : null,
      desconto: data.desconto,
      tipoDesconto: data.tipoDesconto,
      totalServicos: totais.totalServicos,
      totalProdutos: totais.totalProdutos,
      totalGeral: totais.totalGeral,
      tokenPublico,
      servicos: {
        create: data.servicos.map((s, idx) => ({
          servicoId: s.catalogoId || null,
          descricao: s.descricao,
          quantidade: s.quantidade,
          valorUnitario: s.valorUnitario,
          valorTotal: s.quantidade * s.valorUnitario,
          observacao: s.observacao ?? null,
          ordem: idx,
        })),
      },
      produtos: {
        create: data.produtos.map((p, idx) => ({
          produtoId: p.catalogoId || null,
          descricao: p.descricao,
          quantidade: p.quantidade,
          valorUnitario: p.valorUnitario,
          valorTotal: p.quantidade * p.valorUnitario,
          observacao: p.observacao ?? null,
          ordem: idx,
        })),
      },
      ordensServico: {
        create: data.ordensServicoIds.map((osId) => ({ ordemServicoId: osId })),
      },
    },
  });

  return NextResponse.json(orcamento, { status: 201 });
}
