/**
 * PMOC — cronograma: o que as rotas de /api/pmocs/[id]/cronograma têm em comum (plano editável,
 * conferência dos vínculos do item, quem está pedindo e a geração automática ao salvar).
 */
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { pode, type Permissoes } from "@/lib/permissoes";
import { dataISO } from "@/lib/pmoc";
import type { ItemCronogramaInput } from "@/lib/pmoc-cronograma";
import { executarCronograma, type AtorCronograma, type ResultadoCronograma } from "@/lib/pmoc-cronograma-server";

export const atorDoCronograma = (session: Session): AtorCronograma => ({
  empresaId: session.user!.empresaId, usuarioId: session.user!.id,
  podeCancelarOs: pode(session.user!.permissoes as Permissoes, "ordens", "excluir", session.user!.role),
});

interface PlanoDoItem { id: string; dataExpiracao: Date }

/** O plano existe nesta empresa e aceita edição (inativo não aceita). */
export async function planoEditavel(id: string, empresaId: string): Promise<{ pmoc?: PlanoDoItem; erro?: NextResponse }> {
  const pmoc = await prisma.pmoc.findFirst({ where: { id, empresaId }, select: { id: true, ativo: true, dataExpiracao: true } });
  if (!pmoc) return { erro: NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 }) };
  if (!pmoc.ativo) return { erro: NextResponse.json({ erro: "PMOC inativo: reative antes de editar." }, { status: 409 }) };
  return { pmoc };
}

/** Tipo de OS e tipo de equipamento da empresa; equipamento que está NESTE plano; início dentro da validade. */
export async function validarItem(pmoc: PlanoDoItem, empresaId: string, d: ItemCronogramaInput): Promise<string | null> {
  const tipoOs = await prisma.tipoOs.findFirst({ where: { id: d.tipoOsId, empresaId }, select: { ativo: true } });
  if (!tipoOs) return "Tipo de OS inválido.";
  if (!tipoOs.ativo) return "Este tipo de OS está inativo. Escolha outro.";
  if (d.tipoEquipamentoId && !(await prisma.tipoEquipamentoCustom.findFirst({ where: { id: d.tipoEquipamentoId, empresaId }, select: { id: true } })))
    return "Tipo de equipamento inválido.";
  if (d.equipamentoId && !(await prisma.pmocEquipamento.findFirst({ where: { pmocId: pmoc.id, equipamentoId: d.equipamentoId }, select: { id: true } })))
    return "Este equipamento não está no PMOC. Inclua-o na aba Equipamentos AVAC.";
  if (d.dataInicio > dataISO(pmoc.dataExpiracao)!) return "A data de início é depois da expiração do plano.";
  return null;
}

export const dadosDoItem = (d: ItemCronogramaInput) => ({
  tipoEquipamentoId: d.tipoEquipamentoId, equipamentoId: d.equipamentoId, tipoOsId: d.tipoOsId,
  dataInicio: new Date(`${d.dataInicio}T00:00:00Z`), intervaloMeses: d.intervaloMeses, diaExecucao: d.diaExecucao,
});

/**
 * A geração automática: depois de salvar o cronograma (e de publicar o plano), cria as OS que
 * faltam. Nunca muda data nem cancela — isso é o "Reagendar atividades". Uma falha aqui não desfaz o
 * que foi salvo: devolve null e a tela mostra o que ficou pendente.
 */
export async function gerarAoSalvar(pmocId: string, ator: AtorCronograma): Promise<ResultadoCronograma | null> {
  try { return await executarCronograma(pmocId, ator, "criar"); } catch (e) { console.error("[pmoc] geração do cronograma falhou", e); return null; }
}
