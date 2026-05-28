import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// Lista orçamentos disponíveis para vincular a esta OS (mesmo cliente, status RASCUNHO/ENVIADO)
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    select: { clienteId: true },
  });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const orcamentos = await prisma.orcamento.findMany({
    where: {
      empresaId,
      clienteId: os.clienteId,
      status: { in: ["RASCUNHO", "ENVIADO"] },
      ordensServico: { none: { ordemServicoId: id } },
    },
    select: { id: true, codigo: true, nome: true, status: true, totalGeral: true },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(orcamentos);
}

// Vincula um orçamento à OS
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const { orcamentoId } = await req.json();
  if (!orcamentoId) return NextResponse.json({ erro: "Informe o orçamento" }, { status: 400 });

  const [os, orc] = await Promise.all([
    prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true, clienteId: true } }),
    prisma.orcamento.findFirst({ where: { id: orcamentoId, empresaId }, select: { id: true, clienteId: true } }),
  ]);
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  if (!orc) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (os.clienteId !== orc.clienteId) {
    return NextResponse.json({ erro: "OS e orçamento são de clientes diferentes" }, { status: 400 });
  }

  await prisma.orcamentoOs.upsert({
    where: { orcamentoId_ordemServicoId: { orcamentoId, ordemServicoId: id } },
    update: {},
    create: { orcamentoId, ordemServicoId: id },
  });

  return NextResponse.json({ ok: true });
}

// Desvincula
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const { searchParams } = new URL(req.url);
  const orcamentoId = searchParams.get("orcamentoId");
  if (!orcamentoId) return NextResponse.json({ erro: "Informe o orçamento" }, { status: 400 });

  // Garante que o orçamento e a OS são do tenant
  const orc = await prisma.orcamento.findFirst({ where: { id: orcamentoId, empresaId }, select: { id: true } });
  if (!orc) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });

  await prisma.orcamentoOs.deleteMany({
    where: { orcamentoId, ordemServicoId: id },
  });

  return NextResponse.json({ ok: true });
}
