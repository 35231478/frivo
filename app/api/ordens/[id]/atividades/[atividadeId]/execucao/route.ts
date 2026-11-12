import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { carregarExecucao } from "@/lib/execucao/dados";
import { prisma } from "@/lib/prisma";
import { MSG_FORA_DO_ESCOPO, escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

/** A execução da atividade, por equipamento: checklist, respostas, fotos (ids), observação, formulário e o que falta. */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id, atividadeId } = await params;
  // Modo técnico: só as atividades dele
  const escopo = escopoDaSessao(guard.session);
  if (escopo.restrito && !(await prisma.atividadeOs.findFirst({ where: { id: atividadeId, ...filtroEscopo(escopo) }, select: { id: true } })))
    return NextResponse.json({ erro: MSG_FORA_DO_ESCOPO }, { status: 403 });
  const execucao = await carregarExecucao(guard.session.user!.empresaId, id, atividadeId);
  if (!execucao) return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });
  return NextResponse.json(execucao);
}
