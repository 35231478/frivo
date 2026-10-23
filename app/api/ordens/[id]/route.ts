import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import { motivoBloqueioInativacao } from "@/lib/os-server";
import { cancelarOs, statusHttp } from "@/lib/acoes-massa/regras";
import { SOLICITACAO_PENDENTE } from "@/lib/solicitacoes";
import { prisma } from "@/lib/prisma";
import { gerarRelatoriosDaOs } from "@/lib/relatorio-server";
import { verificarConclusaoOs } from "@/lib/execucao/dados";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import { estagioAutomatico, statusCorresponde } from "@/lib/os/status";
import { diaCivilUTC, ehDiaCivil, instanteBR, partesBR } from "@/lib/fuso";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      unidade: { select: { id: true, nome: true, cidade: true, estado: true } },
      contrato: { select: { id: true, numero: true } },
      responsavel: { select: { id: true, nome: true } },
      equipamento: { select: { id: true, nome: true, marca: true, modelo: true } },
      criadoPor: { select: { id: true, nome: true } },
      atividades: {
        include: {
          tipoOs: { select: { id: true, nome: true, cor: true } },
          tecnico: { select: { id: true, nome: true } },
          equipe: { select: { id: true, nome: true, cor: true } },
          tecnicosEquipe: { select: { tecnico: { select: { id: true, nome: true } } }, orderBy: { criadoEm: "asc" } },
          veiculo: { select: { id: true, placa: true, modelo: true, marca: true } },
          respostas: { include: { campo: true } },
        },
        orderBy: { criadoEm: "asc" },
      },
      itensOrcamento: true,
      // Medições OFICIAIS em que a OS entrou (a medição interna OsMedicao saiu do sistema)
      medicaoItens: { select: { medicao: { select: { id: true, numero: true, status: true, valorTotal: true, criadoEm: true } } } },
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
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
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

  // Desloca para o dia escolhido mantendo o horário de BRASÍLIA (o mesmo que o calendário e o app
  // mostram). Previsão só de dia (sem hora) continua só de dia; sem data, 08:00.
  const desloca = (base: Date | null, soDia = false) => {
    if (soDia && (!base || ehDiaCivil(base))) return diaCivilUTC(y, mo, d);
    const p = base ? partesBR(base) : { hora: 8, minuto: 0 };
    return instanteBR(y, mo, d, p.hora, p.minuto);
  };

  if (atividadeId) {
    const ativ = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, ordemServicoId: id } });
    if (!ativ) return NextResponse.json({ erro: "Atividade não encontrada." }, { status: 404 });
    await prisma.atividadeOs.update({ where: { id: atividadeId }, data: { dataAgendada: desloca(ativ.dataAgendada) } });
  } else {
    await prisma.ordemServico.update({ where: { id }, data: { previsaoConclusao: desloca(os.previsaoConclusao, true) } });
  }

  await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId, acao: "OS reagendada", detalhes: `Movida para ${ds}/${ms}/${ys}` },
  });
  await sincronizarStatusOs(id, empresaId, usuarioId);

  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const existente = await prisma.ordemServico.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const { status, prioridade, descricao, observacoes, unidadeId, contratoId, responsavelId, previsaoConclusao } = body;
  // Central da OS: "Voltar ao automático" desliga o ajuste manual e recalcula pelos fatos
  if (body.voltarAutomatico === true) {
    if (existente.status === "CANCELADA")
      return NextResponse.json({ erro: "OS inativada: use “Reabrir” para voltar a trabalhar nela." }, { status: 409 });
    if (existente.statusManual) {
      await prisma.ordemServico.update({ where: { id }, data: { statusManual: false } });
      await prisma.osHistorico.create({ data: { ordemServicoId: id, usuarioId, acao: "Status voltou ao automático", detalhes: `Ajuste manual (${existente.status}) desligado` } });
    }
    await sincronizarStatusOs(id, empresaId, usuarioId);
    return NextResponse.json(await prisma.ordemServico.findUniqueOrThrow({ where: { id } }));
  }
  // Reabrir (de Cancelada) devolve a OS ao status automático; trocar o status à mão em qualquer
  // outro caso é um AJUSTE MANUAL: o automático para de sobrescrever até "Voltar ao automático".
  // Escolher à mão justamente o que os fatos dizem não é exceção: a OS segue (ou volta) no automático.
  const reabrindo = existente.status === "CANCELADA" && status !== undefined && status !== "CANCELADA";
  let ajusteManual = status !== undefined && status !== existente.status && status !== "CANCELADA" && !reabrindo;
  let confirmaAutomatico = false;
  if (ajusteManual) {
    const fatos = await prisma.ordemServico.findUniqueOrThrow({
      where: { id },
      select: { atividades: { select: { status: true, dataAgendada: true } }, medicaoItens: { select: { medicao: { select: { status: true } } } } },
    });
    const automatico = estagioAutomatico({ status: existente.status, previsaoConclusao: existente.previsaoConclusao, atividades: fatos.atividades, medicoes: fatos.medicaoItens.map((m) => m.medicao) });
    confirmaAutomatico = statusCorresponde(status, automatico);
    ajusteManual = !confirmaAutomatico;
  }

  // Mudanças de status com regra própria (o servidor decide, não só a tela)
  if (status !== undefined && status !== existente.status) {
    const { permissoes, role } = session.user!;
    if (status === "CANCELADA") {
      // Cancelar = inativar a OS: exige "excluir" e não pode ter entrado no financeiro
      if (!pode(permissoes, "ordens", "excluir", role))
        return NextResponse.json({ erro: "Sem permissão para cancelar/inativar OS" }, { status: 403 });
      const bloqueio = await motivoBloqueioInativacao(id);
      if (bloqueio) return NextResponse.json({ erro: bloqueio }, { status: 409 });
    }
    if (status === "CONCLUIDA" && !pode(permissoes, "ordens", "concluir", role))
      return NextResponse.json({ erro: "Sem permissão para concluir OS" }, { status: 403 });
    // Trava: a OS só conclui com pelo menos 1 equipamento atendido e o checklist de cada atendido respondido
    if (status === "CONCLUIDA") {
      const r = await verificarConclusaoOs(empresaId, id);
      if (!r.ok) return NextResponse.json({ erro: r.mensagem, pendencias: r.pendencias }, { status: 422 });
    }
  }

  const data: any = {};
  if (status !== undefined) data.status = status;
  if (ajusteManual) data.statusManual = true;
  if (reabrindo || confirmaAutomatico) data.statusManual = false;
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
      data: {
        ordemServicoId: id, usuarioId,
        acao: reabrindo ? "OS reaberta" : ajusteManual ? "Status ajustado manualmente" : "Status alterado",
        detalhes: `${existente.status} → ${status}`,
      },
    });
  }
  if (reabrindo) {
    await sincronizarStatusOs(id, empresaId, usuarioId);
    return NextResponse.json(await prisma.ordemServico.findUniqueOrThrow({ where: { id } }));
  }

  // Ao concluir a OS, gera automaticamente os relatórios (idempotente)
  if (status === "CONCLUIDA" && existente.status !== "CONCLUIDA") {
    try {
      await gerarRelatoriosDaOs(id, empresaId);
    } catch (e) {
      console.error("Falha ao gerar relatórios automáticos da OS", e);
    }
  }

  // Mudou a previsão (e não há ajuste manual): o automático pode mudar (ex.: OS sem atividade com data → Agendada)
  if (previsaoConclusao !== undefined && !atualizado.statusManual && atualizado.status !== "CANCELADA") {
    await sincronizarStatusOs(id, empresaId, usuarioId);
    return NextResponse.json(await prisma.ordemServico.findUniqueOrThrow({ where: { id } }));
  }
  return NextResponse.json(atualizado);
}

/**
 * Inativa a OS — soft-delete: a OS vira CANCELADA (nada é apagado; histórico,
 * atividades, anexos e relatórios ficam preservados) e pode ser reaberta depois.
 * Bloqueia OS que já entrou no financeiro (medição vinculada). Body opcional: { motivo }.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "excluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true, status: true, numero: true, origem: true } });
  if (!os) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim().slice(0, 500) : "";
  // Recusa de solicitação do cliente (gaveta de Solicitações): mesmo fluxo, mas só
  // vale enquanto a solicitação está pendente — evita "recusar" algo já aceito.
  const recusa = body?.recusa === true;
  if (recusa && (os.origem !== SOLICITACAO_PENDENTE.origem || os.status !== SOLICITACAO_PENDENTE.status))
    return NextResponse.json({ erro: "Esta solicitação já foi tratada (aceita ou recusada) por outra pessoa." }, { status: 409 });

  // Mesma regra da ação em massa (lib/acoes-massa/regras.ts)
  const r = await cancelarOs(id, { empresaId, usuarioId: session.user!.id, usuarioNome: session.user!.name ?? "usuário", motivo }, { recusa });
  if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true, status: "CANCELADA" });
}
