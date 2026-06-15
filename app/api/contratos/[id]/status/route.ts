import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { StatusContrato } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

const STATUS_VALIDOS = Object.values(StatusContrato) as string[];

/**
 * Altera o status do contrato e registra a mudança no histórico.
 * Body: { status: StatusContrato, motivo?: string }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const contrato = await prisma.contrato.findFirst({ where: { id, empresaId }, select: { id: true, status: true } });
  if (!contrato) return NextResponse.json({ erro: "Contrato não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const novoStatus = body?.status as string | undefined;
  const motivo = typeof body?.motivo === "string" && body.motivo.trim() ? body.motivo.trim() : null;

  if (!novoStatus || !STATUS_VALIDOS.includes(novoStatus)) {
    return NextResponse.json({ erro: "Status inválido." }, { status: 400 });
  }
  if (novoStatus === contrato.status) {
    return NextResponse.json({ erro: "O contrato já está neste status." }, { status: 400 });
  }

  const [, historico] = await prisma.$transaction([
    prisma.contrato.update({ where: { id }, data: { status: novoStatus as StatusContrato } }),
    prisma.contratoHistoricoStatus.create({
      data: {
        empresaId,
        contratoId: id,
        statusAnterior: contrato.status,
        statusNovo: novoStatus as StatusContrato,
        motivo,
        usuarioId,
      },
      include: { usuario: { select: { id: true, nome: true } } },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    status: novoStatus,
    historico: {
      id: historico.id,
      statusAnterior: historico.statusAnterior,
      statusNovo: historico.statusNovo,
      motivo: historico.motivo,
      createdAt: historico.createdAt,
      usuario: historico.usuario,
    },
  });
}
