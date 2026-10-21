/**
 * Contexto das rotas que GRAVAM a execução de uma atividade (respostas, fotos, observação, formulário):
 * permissão (OS › editar ou concluir), empresa da sessão, atividade da OS, atividade aberta e — quando
 * pedido — o equipamento vinculado a ela. Toda gravação é incremental (só o que veio no corpo).
 */
import { NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { STATUS_BLOQUEADOS } from "@/lib/execucao/dados";

export const MSG_BLOQUEADA = "Atividade concluída: reabra a atividade para alterar a execução.";
export const MSG_CANCELADA = "Atividade cancelada: a execução não pode ser alterada.";

type Falha = { ok: false; resposta: Response };
export interface ContextoExecucao {
  ok: true;
  empresaId: string;
  usuarioId: string;
  atividade: { id: string; status: string; tipoOsId: string | null; tecnicoId: string | null; ordemServico: { id: string; clienteId: string; unidadeId: string | null } };
  vinculo: { id: string; feito: boolean; equipamento: { id: string; tipoEquipamentoId: string | null } } | null;
}

const falha = (status: number, erro: string): Falha => ({ ok: false, resposta: NextResponse.json({ erro }, { status }) });

export async function contextoExecucao(osId: string, atividadeId: string, equipamentoId?: string): Promise<ContextoExecucao | Falha> {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return { ok: false, resposta: guard.resposta };
  const empresaId = guard.session.user!.empresaId;
  const atividade = await prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: osId, empresaId },
    select: { id: true, status: true, tipoOsId: true, tecnicoId: true, ordemServico: { select: { id: true, clienteId: true, unidadeId: true } } },
  });
  if (!atividade) return falha(404, "Atividade não encontrada");
  if (STATUS_BLOQUEADOS.includes(atividade.status)) return falha(409, atividade.status === "CANCELADA" ? MSG_CANCELADA : MSG_BLOQUEADA);
  let vinculo: ContextoExecucao["vinculo"] = null;
  if (equipamentoId) {
    vinculo = await prisma.atividadeEquipamento.findFirst({
      where: { atividadeId, equipamentoId },
      select: { id: true, feito: true, equipamento: { select: { id: true, tipoEquipamentoId: true } } },
    });
    if (!vinculo) return falha(404, "Este equipamento não está vinculado a esta atividade.");
  }
  return { ok: true, empresaId, usuarioId: guard.session.user!.id, atividade, vinculo };
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
  const item = await prisma.checklistTipoItem.findFirst({ where: { id: itemId, empresaId }, select: { id: true, texto: true, ativo: true, tipoEquipamentoId: true } });
  if (!item) return null;
  if (item.ativo && item.tipoEquipamentoId === equipamento.tipoEquipamentoId) return item;
  const ja = await prisma.checklistResposta.findFirst({ where: { atividadeId, equipamentoId: equipamento.id, itemId }, select: { id: true } });
  return ja ? item : null;
}
