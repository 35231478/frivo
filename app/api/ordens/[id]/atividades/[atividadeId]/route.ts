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

  // Gate "obrigatório para concluir": não finaliza a atividade sem responder os
  // formulários marcados como obrigatórios (por tipo de OS + tipo de equipamento).
  // Opt-in: só bloqueia quando algum vínculo tem obrigatorioConcluir = true.
  if (status === "CONCLUIDA" && existente.status !== "CONCLUIDA" && existente.tipoOsId) {
    const feitos = await prisma.atividadeEquipamento.findMany({
      where: { atividadeId, feito: true },
      select: { equipamentoId: true, equipamento: { select: { tipoEquipamentoId: true } } },
    });
    const tipoIds = [...new Set(feitos.map((f) => f.equipamento.tipoEquipamentoId).filter(Boolean) as string[])];
    if (tipoIds.length > 0) {
      const obrig = await prisma.formTypeMapping.findMany({
        where: { empresaId, tipoOsId: existente.tipoOsId, tipoEquipamentoId: { in: tipoIds }, obrigatorioConcluir: true },
        select: { tipoEquipamentoId: true, formularioTemplateId: true, formularioTemplate: { select: { nome: true, _count: { select: { campos: true } } } } },
      });
      if (obrig.length > 0) {
        const respostas = await prisma.respostaFormularioEquipamento.findMany({
          where: { atividadeId },
          select: { equipamentoId: true, formularioId: true, campoId: true },
        });
        const respMap = new Map<string, Set<string>>(); // `${equipId}|${formId}` -> Set(campoId)
        for (const r of respostas) {
          const k = `${r.equipamentoId}|${r.formularioId}`;
          if (!respMap.has(k)) respMap.set(k, new Set());
          respMap.get(k)!.add(r.campoId);
        }
        const mapByTipo = new Map(obrig.map((o) => [o.tipoEquipamentoId, o]));
        const pendentes = new Set<string>();
        for (const f of feitos) {
          const tid = f.equipamento.tipoEquipamentoId;
          if (!tid) continue;
          const o = mapByTipo.get(tid);
          if (!o) continue;
          const total = o.formularioTemplate._count.campos;
          if (total === 0) continue;
          const respondidos = respMap.get(`${f.equipamentoId}|${o.formularioTemplateId}`)?.size ?? 0;
          if (respondidos < total) pendentes.add(o.formularioTemplate.nome);
        }
        if (pendentes.size > 0) {
          return NextResponse.json(
            { erro: `Responda o(s) formulário(s) obrigatório(s) antes de concluir: ${[...pendentes].join(", ")}.` },
            { status: 400 },
          );
        }
      }
    }
  }

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
