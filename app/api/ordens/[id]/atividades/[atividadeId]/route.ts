import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;
  const body = await req.json();

  const existente = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, ordemServicoId: id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const { status, titulo, tipoOsId, tecnicoId, dataAgendada, duracaoMin, observacao, resumo } = body;
  const data: any = {};
  if (status !== undefined) data.status = status;
  if (titulo !== undefined) data.titulo = titulo;
  if (tipoOsId !== undefined) data.tipoOsId = tipoOsId || null;
  if (tecnicoId !== undefined) data.tecnicoId = tecnicoId || null;
  if (dataAgendada !== undefined) data.dataAgendada = dataAgendada ? new Date(dataAgendada) : null;
  if (duracaoMin !== undefined) data.duracaoMin = duracaoMin;
  if (observacao !== undefined) data.observacao = observacao;
  if (resumo !== undefined) data.resumo = resumo;

  const atualizado = await prisma.atividadeOs.update({
    where: { id: atividadeId }, data,
    include: {
      tipoOs: { select: { id: true, nome: true, cor: true } },
      tecnico: { select: { id: true, nome: true } },
      respostas: { include: { campo: true } },
    },
  });

  if (status && status !== existente.status) {
    await prisma.osHistorico.create({
      data: {
        ordemServicoId: id, usuarioId: session.user!.id,
        acao: "Status da atividade alterado",
        detalhes: `"${existente.titulo}": ${existente.status} → ${status}`,
      },
    });
  }

  return NextResponse.json(atualizado);
}
