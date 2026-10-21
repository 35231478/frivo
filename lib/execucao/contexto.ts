/**
 * Contexto das rotas que GRAVAM a execução de uma atividade (respostas, fotos, observação, formulário,
 * serviço adicional): permissão (OS › editar ou concluir), empresa da sessão, atividade (da OS, quando
 * a rota diz qual), atividade aberta, escopo do técnico (no modo técnico, só as atividades dele) e —
 * quando pedido — o equipamento vinculado a ela. Toda gravação é incremental (só o que veio no corpo).
 * O mesmo contexto serve à tela da OS (rotas REST) e à sincronização do app do técnico.
 */
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { STATUS_BLOQUEADOS } from "@/lib/execucao/dados";
import { MSG_FORA_DO_ESCOPO, escopoDaSessao, filtroEscopo, type EscopoTecnico } from "@/lib/tecnico/escopo";

export const MSG_BLOQUEADA = "Atividade concluída: reabra a atividade para alterar a execução.";
export const MSG_CANCELADA = "Atividade cancelada: a execução não pode ser alterada.";

export type Falha = { ok: false; status: number; erro: string; resposta: Response };
/** Quem grava: empresa e usuário da sessão + o escopo (modo técnico) */
export interface Ator { empresaId: string; usuarioId: string; escopo: EscopoTecnico }
export interface ContextoExecucao {
  ok: true;
  empresaId: string;
  usuarioId: string;
  escopo: EscopoTecnico;
  atividade: {
    id: string; titulo: string; status: string; tipoOsId: string | null; tecnicoId: string | null;
    ordemServico: { id: string; clienteId: string; unidadeId: string | null };
  };
  vinculo: { id: string; feito: boolean; equipamento: { id: string; tipoEquipamentoId: string | null } } | null;
}

export const falha = (status: number, erro: string): Falha => ({ ok: false, status, erro, resposta: NextResponse.json({ erro }, { status }) });

export const atorDaSessao = (session: Session): Ator => ({
  empresaId: session.user.empresaId, usuarioId: session.user.id, escopo: escopoDaSessao(session),
});

/**
 * Carrega o contexto para um ator já autenticado. `osId` (rotas da OS) confere que a atividade é
 * daquela OS; `permitirBloqueada` deixa passar atividade concluída/cancelada (quem decide é a ação).
 */
export async function carregarContexto(
  ator: Ator, atividadeId: string,
  op: { osId?: string; equipamentoId?: string; permitirBloqueada?: boolean } = {},
): Promise<ContextoExecucao | Falha> {
  const select = {
    id: true, titulo: true, status: true, tipoOsId: true, tecnicoId: true,
    ordemServico: { select: { id: true, clienteId: true, unidadeId: true } },
  } as const;
  const where = { id: atividadeId, empresaId: ator.empresaId, ...(op.osId && { ordemServicoId: op.osId }) };
  const atividade = await prisma.atividadeOs.findFirst({ where, select });
  if (!atividade) return falha(404, "Atividade não encontrada");
  if (ator.escopo.restrito) {
    const minha = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, ...filtroEscopo(ator.escopo) }, select: { id: true } });
    if (!minha) return falha(403, MSG_FORA_DO_ESCOPO);
  }
  if (!op.permitirBloqueada && STATUS_BLOQUEADOS.includes(atividade.status))
    return falha(409, atividade.status === "CANCELADA" ? MSG_CANCELADA : MSG_BLOQUEADA);
  let vinculo: ContextoExecucao["vinculo"] = null;
  if (op.equipamentoId) {
    vinculo = await prisma.atividadeEquipamento.findFirst({
      where: { atividadeId, equipamentoId: op.equipamentoId },
      select: { id: true, feito: true, equipamento: { select: { id: true, tipoEquipamentoId: true } } },
    });
    if (!vinculo) return falha(404, "Este equipamento não está vinculado a esta atividade.");
  }
  return { ok: true, ...ator, atividade, vinculo };
}

/** Rotas REST da OS: guarda de permissão + contexto. */
export async function contextoExecucao(osId: string, atividadeId: string, equipamentoId?: string): Promise<ContextoExecucao | Falha> {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return { ok: false, status: guard.resposta.status, erro: "Sem permissão", resposta: guard.resposta };
  return carregarContexto(atorDaSessao(guard.session), atividadeId, { osId, equipamentoId });
}

/** Respondeu algo do equipamento: ele passa a contar como ATENDIDO nesta atividade. */
export async function marcarAtendido(vinculo: { id: string; feito: boolean }) {
  if (vinculo.feito) return;
  await prisma.atividadeEquipamento.update({ where: { id: vinculo.id }, data: { feito: true, feitoEm: new Date() } });
  vinculo.feito = true;
}

/**
 * O item pode ser respondido para este equipamento? Sim se é um item ATIVO do checklist do tipo dele,
 * ou se já foi respondido antes (item que saiu do checklist continua editável onde já tem resposta).
 */
export async function itemDoEquipamento(empresaId: string, atividadeId: string, equipamento: { id: string; tipoEquipamentoId: string | null }, itemId: string) {
  const item = await prisma.checklistTipoItem.findFirst({
    where: { id: itemId, empresaId },
    select: { id: true, texto: true, ativo: true, tipoEquipamentoId: true, tipoResposta: true, unidade: true },
  });
  if (!item) return null;
  if (item.ativo && item.tipoEquipamentoId === equipamento.tipoEquipamentoId) return item;
  const ja = await prisma.checklistResposta.findFirst({ where: { atividadeId, equipamentoId: equipamento.id, itemId }, select: { id: true } });
  return ja ? item : null;
}
