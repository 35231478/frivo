import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { equipamentoSchema } from "@/lib/validations";
import { resolverTipoEquipamentoId } from "@/lib/tipo-equipamento";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const eq = await prisma.equipamento.findFirst({
    where: { id, empresaId },
    include: {
      unidade: {
        include: { cliente: { select: { id: true, nome: true, nomeFantasia: true } } },
      },
    },
  });
  if (!eq) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(eq);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.equipamento.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = equipamentoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const unidade = await prisma.unidade.findFirst({ where: { id: parsed.data.unidadeId, empresaId } });
  if (!unidade) return NextResponse.json({ erro: "Unidade não encontrada" }, { status: 404 });

  const { dataInstalacao, dataFabricacao, garantiaAte, ...resto } = parsed.data;
  const tipoEquipamentoId = await resolverTipoEquipamentoId(empresaId, resto.tipo);
  const atualizado = await prisma.equipamento.update({
    where: { id },
    data: {
      ...resto,
      tipoEquipamentoId,
      dataInstalacao: dataInstalacao ? new Date(dataInstalacao) : null,
      dataFabricacao: dataFabricacao ? new Date(dataFabricacao) : null,
      garantiaAte: garantiaAte ? new Date(garantiaAte) : null,
    },
  });
  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.equipamento.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.equipamento.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
