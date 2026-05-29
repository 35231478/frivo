import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dataAgendadaRecorrencia } from "@/lib/recorrencia-helpers";

type Params = { params: Promise<{ id: string }> };

/**
 * Gera (idempotente) uma OS recorrente para um contrato em um mês específico.
 * Body: { mes, ano } (default: mês/ano corrente). Usado pelo relatório de contratos.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const body = await req.json().catch(() => ({}));
  const agora = new Date();
  const mes = Number(body?.mes) || agora.getMonth() + 1;
  const ano = Number(body?.ano) || agora.getFullYear();
  const periodo = `${ano}-${String(mes).padStart(2, "0")}`;

  const contrato = await prisma.contrato.findFirst({
    where: { id, empresaId },
    include: { cliente: { select: { id: true } }, tipoOsRecorrencia: { select: { id: true, nome: true } } },
  });
  if (!contrato) return NextResponse.json({ erro: "Contrato não encontrado" }, { status: 404 });

  const existente = await prisma.ordemServico.findFirst({
    where: { empresaId, contratoId: id, periodoRecorrencia: periodo },
    select: { id: true },
  });
  if (existente) return NextResponse.json({ id: existente.id, jaExistia: true });

  const dataAgendada = dataAgendadaRecorrencia(ano, mes, (contrato as any).diaRecorrencia ?? contrato.diaVencimento ?? 1, (contrato as any).fimSemanaRecorrencia);
  const seq = (await prisma.ordemServico.count({ where: { empresaId } })) + 1;
  const numero = `OS-${ano}-${String(seq).padStart(4, "0")}`;
  const tituloTipo = contrato.tipoOsRecorrencia?.nome ?? "Manutenção do contrato";

  const os = await prisma.ordemServico.create({
    data: {
      empresaId,
      numero,
      clienteId: contrato.clienteId,
      contratoId: contrato.id,
      criadoPorId: usuarioId,
      status: "AGENDADA",
      origem: "RECORRENTE",
      periodoRecorrencia: periodo,
      prioridade: "NORMAL",
      descricao: `${tituloTipo} — contrato ${contrato.numero} (${String(mes).padStart(2, "0")}/${ano})`,
      previsaoConclusao: dataAgendada,
      atividades: (contrato.tipoOsRecorrenciaId || contrato.tecnicoRecorrenciaId)
        ? { create: { empresaId, tipoOsId: contrato.tipoOsRecorrenciaId || null, tecnicoId: contrato.tecnicoRecorrenciaId || null, titulo: tituloTipo, status: "AGENDADA", dataAgendada } }
        : undefined,
    },
  });

  await prisma.osHistorico.create({
    data: { ordemServicoId: os.id, usuarioId, acao: "OS gerada do relatório de contratos", detalhes: `Contrato ${contrato.numero} — ${periodo}.` },
  });

  return NextResponse.json({ id: os.id, jaExistia: false }, { status: 201 });
}
