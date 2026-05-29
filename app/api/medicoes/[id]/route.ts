import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { medicaoSchema } from "@/lib/validations";
import { calcularTotaisMedicao } from "@/lib/medicao-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const medicao = await prisma.medicao.findFirst({
    where: { id, empresaId },
    include: {
      cliente: true,
      contrato: { select: { id: true, numero: true } },
      itens: { orderBy: { ordem: "asc" } },
      nfs: { orderBy: { emitidaEm: "desc" } },
      contasReceber: true,
    },
  });
  if (!medicao) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(medicao);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.medicao.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  if (existente.status !== "RASCUNHO") {
    return NextResponse.json({ erro: "Só é possível editar medições em rascunho" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = medicaoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const totais = calcularTotaisMedicao(data.itens, data.descontoValor, data.descontoPercent);

  const atualizada = await prisma.medicao.update({
    where: { id },
    data: {
      clienteId: data.clienteId,
      contratoId: data.contratoId || null,
      tipo: data.tipo,
      mes: data.mes ?? null,
      ano: data.ano ?? null,
      descricao: data.descricao ?? null,
      observacao: data.observacao ?? null,
      valorTotal: totais.valorTotal,
      descontoValor: data.descontoValor,
      descontoPercent: data.descontoPercent,
      valorLiquido: totais.valorLiquido,
      itens: {
        deleteMany: {},
        create: data.itens.map((it, idx) => ({
          tipo: it.tipo,
          servicoId: it.servicoId || null,
          produtoId: it.produtoId || null,
          ordemServicoId: it.ordemServicoId || null,
          orcamentoId: it.orcamentoId || null,
          descricao: it.descricao,
          quantidade: it.quantidade,
          valorUnitario: it.valorUnitario,
          valorTotal: it.quantidade * it.valorUnitario,
          codigoMunicipal: it.codigoMunicipal || null,
          aliquotaISS: it.aliquotaISS ?? null,
          aliquotaPIS: it.aliquotaPIS ?? null,
          aliquotaCOFINS: it.aliquotaCOFINS ?? null,
          aliquotaCSLL: it.aliquotaCSLL ?? null,
          aliquotaIR: it.aliquotaIR ?? null,
          observacao: it.observacao ?? null,
          ordem: idx,
        })),
      },
    },
  });

  return NextResponse.json(atualizada);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.medicao.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.medicao.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
