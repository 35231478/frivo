import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gerarRelatoriosDaOs } from "@/lib/relatorio-server";

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
      orcamentos: {
        include: {
          orcamento: {
            select: {
              id: true, codigo: true, nome: true, status: true, totalGeral: true,
              criadoEm: true, validadeEm: true, tokenPublico: true,
            },
          },
        },
      },
    },
  });
  if (!os) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(os);
}

// Reagendamento rápido (drag-and-drop no calendário): move a OS para outro dia.
// Body: { data: "YYYY-MM-DD", atividadeId?: string }
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId } });
  if (!os) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  if (os.status === "CONCLUIDA" || os.status === "CANCELADA") {
    return NextResponse.json({ erro: "Não é possível reagendar OS concluída ou cancelada." }, { status: 422 });
  }

  const body = await req.json();
  const data: string | undefined = body?.data;
  const atividadeId: string | undefined = body?.atividadeId || undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data ?? "");
  if (!m) return NextResponse.json({ erro: "Data inválida." }, { status: 400 });
  const [, ys, ms, ds] = m;
  const y = Number(ys), mo = Number(ms) - 1, d = Number(ds);

  // Desloca a data mantendo o horário existente (setFullYear opera no fuso do servidor,
  // o mesmo usado para posicionar os cards no calendário).
  const desloca = (base: Date | null) => {
    const dt = base ? new Date(base) : new Date(y, mo, d, 8, 0, 0, 0);
    dt.setFullYear(y, mo, d);
    return dt;
  };

  if (atividadeId) {
    const ativ = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, ordemServicoId: id } });
    if (!ativ) return NextResponse.json({ erro: "Atividade não encontrada." }, { status: 404 });
    await prisma.atividadeOs.update({ where: { id: atividadeId }, data: { dataAgendada: desloca(ativ.dataAgendada) } });
  } else {
    await prisma.ordemServico.update({ where: { id }, data: { previsaoConclusao: desloca(os.previsaoConclusao) } });
  }

  await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId, acao: "OS reagendada", detalhes: `Movida para ${ds}/${ms}/${ys}` },
  });

  return NextResponse.json({ ok: true });
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

  // Ao concluir a OS, gera automaticamente os relatórios (idempotente)
  if (status === "CONCLUIDA" && existente.status !== "CONCLUIDA") {
    try {
      await gerarRelatoriosDaOs(id, empresaId);
    } catch (e) {
      console.error("Falha ao gerar relatórios automáticos da OS", e);
    }
  }

  return NextResponse.json(atualizado);
}
