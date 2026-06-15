import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contratoSchema } from "@/lib/validations";
import { gerarPrevisaoContratoContasReceber } from "@/lib/financeiro-server";
import { gerarOsRecorrentesContrato } from "@/lib/recorrencia-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const contrato = await prisma.contrato.findFirst({
    where: { id, empresaId },
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      responsavelTecnico: { select: { id: true, nome: true, crea: true } },
      unidades: { include: { unidade: true } },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, categoria: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      reajustes: { orderBy: { data: "desc" } },
    },
  });
  if (!contrato) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(contrato);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contrato.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = contratoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.numero !== existente.numero) {
    const dup = await prisma.contrato.findUnique({
      where: { numero_empresaId: { numero: parsed.data.numero, empresaId } },
    });
    if (dup) return NextResponse.json({ erro: "Número já cadastrado" }, { status: 409 });
  }

  const { unidadeIds, dataInicio, dataFim, valorMensal, valorTotal, responsavelTecnicoId, tipoOsRecorrenciaId, tecnicoRecorrenciaId, artVencimento, itensInclusos, ...resto } = parsed.data;

  const atualizado = await prisma.$transaction(async (tx) => {
    await tx.contratoUnidade.deleteMany({ where: { contratoId: id } });
    return tx.contrato.update({
      where: { id },
      data: {
        ...resto,
        dataInicio: new Date(dataInicio),
        dataFim: dataFim ? new Date(dataFim) : null,
        valorMensal: valorMensal ?? null,
        valorTotal: valorTotal ?? null,
        responsavelTecnicoId: responsavelTecnicoId || null,
        tipoOsRecorrenciaId: tipoOsRecorrenciaId || null,
        tecnicoRecorrenciaId: tecnicoRecorrenciaId || null,
        artVencimento: artVencimento ? new Date(artVencimento) : null,
        ...(itensInclusos ? { itensInclusos: itensInclusos as any } : {}),
        unidades: {
          create: unidadeIds.map((unidadeId) => ({ unidadeId })),
        },
      },
      include: { unidades: true },
    });
  });

  // Atualiza a previsão de contas a receber (idempotente).
  await gerarPrevisaoContratoContasReceber(id).catch(() => 0);
  // Gera as OS recorrentes futuras (idempotente), se a recorrência estiver ativa.
  if (atualizado.recorrencia) await gerarOsRecorrentesContrato(id, session.user!.id).catch(() => 0);

  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contrato.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.contrato.update({ where: { id }, data: { status: "ENCERRADO" } });
  return NextResponse.json({ ok: true });
}
