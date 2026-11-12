import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { STATUS_BLOQUEADOS } from "@/lib/execucao/dados";
import { MSG_BLOQUEADA } from "@/lib/execucao/contexto";

type Params = { params: Promise<{ id: string; atividadeId: string; vinculoId: string }> };

/**
 * Tira o equipamento da atividade — só enquanto não há NADA dele gravado nela (checklist, fotos,
 * formulário). Com execução, nada é apagado: marque como "não atendido" na execução.
 * (Atendido/não atendido e observação: PATCH .../execucao/equipamentos/[equipamentoId].)
 */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, atividadeId, vinculoId } = await params;

  const vinculo = await prisma.atividadeEquipamento.findFirst({
    where: { id: vinculoId, atividadeId, atividade: { ordemServicoId: id, empresaId: session.user!.empresaId } },
    select: { id: true, equipamentoId: true, atividade: { select: { status: true } } },
  });
  if (!vinculo) return NextResponse.json({ erro: "Equipamento não encontrado na atividade" }, { status: 404 });
  if (STATUS_BLOQUEADOS.includes(vinculo.atividade.status)) return NextResponse.json({ erro: MSG_BLOQUEADA }, { status: 409 });

  const onde = { atividadeId, equipamentoId: vinculo.equipamentoId };
  const [respostas, fotos, formulario] = await Promise.all([
    prisma.checklistResposta.count({ where: onde }),
    prisma.fotoAtendimento.count({ where: onde }),
    prisma.respostaFormularioEquipamento.count({ where: onde }),
  ]);
  if (respostas || fotos || formulario)
    return NextResponse.json({ erro: "Este equipamento já tem checklist, fotos ou formulário nesta atividade: para não perder o que foi feito, marque-o como “não atendido” na execução em vez de remover." }, { status: 409 });

  await prisma.atividadeEquipamento.delete({ where: { id: vinculoId } });
  return NextResponse.json({ ok: true });
}
