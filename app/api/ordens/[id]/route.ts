import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      unidade: { select: { id: true, nome: true, cidade: true, estado: true } },
      contrato: { select: { id: true, numero: true } },
      responsavel: { select: { id: true, nome: true } },
      criadoPor: { select: { id: true, nome: true } },
      atividades: {
        include: {
          tipoOs: { select: { id: true, nome: true, cor: true } },
          tecnico: { select: { id: true, nome: true } },
          respostas: { include: { campo: true } },
        },
        orderBy: { criadoEm: "asc" },
      },
      itensOrcamento: true,
      medicoes: { include: { itensFinanceiro: true }, orderBy: { numero: "asc" } },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      historico: { include: { usuario: { select: { nome: true } } }, orderBy: { criadoEm: "desc" } },
    },
  });
  if (!os) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(os);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const existente = await prisma.ordemServico.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const { status, prioridade, descricao, observacoes, unidadeId, contratoId, responsavelId, previsaoConclusao } = body;

  const data: any = {};
  if (status !== undefined) data.status = status;
  if (prioridade !== undefined) data.prioridade = prioridade;
  if (descricao !== undefined) data.descricao = descricao;
  if (observacoes !== undefined) data.observacoes = observacoes;
  if (unidadeId !== undefined) data.unidadeId = unidadeId || null;
  if (contratoId !== undefined) data.contratoId = contratoId || null;
  if (responsavelId !== undefined) data.responsavelId = responsavelId || null;
  if (previsaoConclusao !== undefined) data.previsaoConclusao = previsaoConclusao ? new Date(previsaoConclusao) : null;

  if (status === "EM_ANDAMENTO" && !existente.dataInicio) data.dataInicio = new Date();
  if (status === "CONCLUIDA" && !existente.dataConclusao) data.dataConclusao = new Date();

  const atualizado = await prisma.ordemServico.update({ where: { id }, data });

  if (status && status !== existente.status) {
    await prisma.osHistorico.create({
      data: { ordemServicoId: id, usuarioId, acao: "Status alterado", detalhes: `${existente.status} → ${status}` },
    });
  }

  return NextResponse.json(atualizado);
}
