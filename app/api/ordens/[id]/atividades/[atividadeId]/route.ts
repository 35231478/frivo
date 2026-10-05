import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;
  const body = await req.json();

  const existente = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, ordemServicoId: id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const { status, titulo, tipoOsId, tecnicoId, dataAgendada, duracaoMin, observacao, resumo } = body;

  // Editar os dados da atividade exige "editar"; quem só pode "concluir" (execução em campo)
  // continua podendo mudar o status e o resumo.
  const editandoDados = [titulo, tipoOsId, tecnicoId, dataAgendada, duracaoMin, observacao].some((v) => v !== undefined);
  if (editandoDados) {
    if (!pode(session.user!.permissoes, "ordens", "editar", session.user!.role))
      return NextResponse.json({ erro: "Sem permissão para editar a atividade" }, { status: 403 });
    if (titulo !== undefined && !String(titulo).trim())
      return NextResponse.json({ erro: "O título da atividade é obrigatório." }, { status: 400 });
    // Tipo de OS e técnico precisam ser da mesma empresa
    if (tipoOsId && !(await prisma.tipoOs.findFirst({ where: { id: tipoOsId, empresaId }, select: { id: true } })))
      return NextResponse.json({ erro: "Tipo de OS inválido." }, { status: 400 });
    if (tecnicoId && !(await prisma.tecnico.findFirst({ where: { id: tecnicoId, empresaId }, select: { id: true } })))
      return NextResponse.json({ erro: "Técnico inválido." }, { status: 400 });
  }

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

  if (editandoDados) {
    const mudou = [
      titulo !== undefined && titulo !== existente.titulo && "título",
      tipoOsId !== undefined && (tipoOsId || null) !== existente.tipoOsId && "tipo de OS",
      tecnicoId !== undefined && (tecnicoId || null) !== existente.tecnicoId && "técnico",
      dataAgendada !== undefined && "data agendada",
      duracaoMin !== undefined && duracaoMin !== existente.duracaoMin && "duração",
      observacao !== undefined && observacao !== existente.observacao && "observação",
    ].filter(Boolean);
    if (mudou.length) {
      await prisma.osHistorico.create({
        data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Atividade editada", detalhes: `"${atualizado.titulo}": ${mudou.join(", ")}` },
      });
    }
  }

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

/**
 * Exclui a atividade — só enquanto não houver execução registrada. Atividade com
 * respostas, fotos, relatório, equipamento marcado como atendido ou concluída não
 * é apagada (perderia o registro do serviço): nesse caso, cancele a atividade.
 */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "excluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  const atividade = await prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: id, empresaId },
    select: {
      id: true, titulo: true, status: true,
      _count: { select: { respostas: true, respostasEquipamento: true, relatorios: true } },
      equipamentos: { where: { feito: true }, select: { id: true }, take: 1 },
    },
  });
  if (!atividade) return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });

  const c = atividade._count;
  if (atividade.status === "CONCLUIDA" || c.respostas || c.respostasEquipamento || c.relatorios || atividade.equipamentos.length) {
    return NextResponse.json({
      erro: "Esta atividade já tem execução registrada (concluída, formulários/fotos, relatório ou equipamento atendido) e não pode ser excluída. Para tirá-la do fluxo, altere o status para Cancelada.",
    }, { status: 409 });
  }

  await prisma.atividadeOs.delete({ where: { id: atividadeId } });
  await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Atividade excluída", detalhes: atividade.titulo },
  });
  return NextResponse.json({ ok: true });
}
