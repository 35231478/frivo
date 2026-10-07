import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { ErroTecnicos, INCLUDE_TECNICOS_ATIVIDADE, gravarTecnicos, lerDefinicao, lerVeiculo, resolverTecnicos, resolverVeiculo } from "@/lib/atividade-tecnicos";

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
  const def = lerDefinicao(body);
  const veiculoPedido = lerVeiculo(body);
  const editandoDados = [titulo, tipoOsId, tecnicoId, dataAgendada, duracaoMin, observacao, def, veiculoPedido].some((v) => v !== undefined);
  if (editandoDados) {
    if (!pode(session.user!.permissoes, "ordens", "editar", session.user!.role))
      return NextResponse.json({ erro: "Sem permissão para editar a atividade" }, { status: 403 });
    if (titulo !== undefined && !String(titulo).trim())
      return NextResponse.json({ erro: "O título da atividade é obrigatório." }, { status: 400 });
    // Tipo de OS e técnico precisam ser da mesma empresa
    if (tipoOsId && !(await prisma.tipoOs.findFirst({ where: { id: tipoOsId, empresaId }, select: { id: true } })))
      return NextResponse.json({ erro: "Tipo de OS inválido." }, { status: 400 });
  }
  // Quem executa (o responsável vira o tecnico_id; os demais, atividade_tecnicos). Ao salvar a
  // composição ela é OBRIGATÓRIA — mudar só o status (execução em campo) segue sem exigir nada,
  // então atividades antigas sem executor não quebram.
  let tecnicos: Awaited<ReturnType<typeof resolverTecnicos>> | null = null;
  // Veículo desta atividade: só muda quando enviado (null = sem veículo). Não mexe no vínculo padrão.
  let veiculoId: string | null | undefined;
  const antes = def ? await prisma.atividadeTecnico.findMany({ where: { atividadeId }, select: { tecnicoId: true } }) : [];
  try {
    if (def) {
      const tipoFinal = tipoOsId !== undefined ? (tipoOsId || null) : existente.tipoOsId;
      // Quem já está na atividade segue aceito mesmo se foi inativado (só vínculo novo exige ativo)
      const vinculosAtuais = {
        tecnicoIds: [existente.tecnicoId, ...antes.map((a) => a.tecnicoId)].filter((x): x is string => !!x),
        equipeId: existente.equipeId,
      };
      tecnicos = await resolverTecnicos(empresaId, def, tipoFinal, { exigir: true, vinculosAtuais });
    }
    if (veiculoPedido !== undefined) veiculoId = await resolverVeiculo(empresaId, veiculoPedido, { responsavel: null, equipeId: null });
  } catch (e) { if (e instanceof ErroTecnicos) return NextResponse.json({ erro: e.message }, { status: 400 }); throw e; }

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
        // Formulário inativo não é mais exigido (não trava atividades que já o usavam)
        where: { empresaId, tipoOsId: existente.tipoOsId, tipoEquipamentoId: { in: tipoIds }, obrigatorioConcluir: true, formularioTemplate: { ativo: true } },
        select: { tipoEquipamentoId: true, formularioTemplateId: true, formularioTemplate: { select: { nome: true, campos: { where: { ativo: true }, select: { id: true } } } } },
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
          // Só campos ativos contam (campo removido na edição não é mais exigido)
          const ativos = o.formularioTemplate.campos.map((c) => c.id);
          const total = ativos.length;
          if (total === 0) continue;
          const resp = respMap.get(`${f.equipamentoId}|${o.formularioTemplateId}`);
          const respondidos = ativos.filter((c) => resp?.has(c)).length;
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
  if (veiculoId !== undefined) data.veiculoId = veiculoId;
  if (dataAgendada !== undefined) data.dataAgendada = dataAgendada ? new Date(dataAgendada) : null;
  if (duracaoMin !== undefined) data.duracaoMin = duracaoMin;
  if (observacao !== undefined) data.observacao = observacao;
  if (resumo !== undefined) data.resumo = resumo;

  const atualizado = await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.atividadeOs.update({ where: { id: atividadeId }, data });
    if (tecnicos) await gravarTecnicos(tx, atividadeId, tecnicos);
    return tx.atividadeOs.findUniqueOrThrow({
      where: { id: atividadeId },
      include: { tipoOs: { select: { id: true, nome: true, cor: true } }, ...INCLUDE_TECNICOS_ATIVIDADE, respostas: { include: { campo: true } } },
    });
  });
  const mudouEquipe = !!tecnicos && (
    tecnicos.responsavel !== existente.tecnicoId || tecnicos.equipeId !== existente.equipeId
    || [...tecnicos.outros].sort().join() !== antes.map((a) => a.tecnicoId).sort().join()
  );

  if (editandoDados) {
    const mudou = [
      titulo !== undefined && titulo !== existente.titulo && "título",
      tipoOsId !== undefined && (tipoOsId || null) !== existente.tipoOsId && "tipo de OS",
      mudouEquipe && "técnicos/equipe",
      veiculoId !== undefined && veiculoId !== existente.veiculoId && "veículo",
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
