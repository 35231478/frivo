import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { respostaAudio } from "@/lib/execucao/audio";
import { escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";

type Params = { params: Promise<{ id: string }> };

/** O áudio da observação de um item do checklist (execução da OS e histórico do equipamento). */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["ordens", "visualizar"], ["equipamentos", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const escopo = escopoDaSessao(guard.session);
  const r = await prisma.checklistResposta.findFirst({
    where: { id, empresaId: guard.session.user.empresaId, audioUrl: { not: null }, ...(escopo.restrito && { atividade: filtroEscopo(escopo) }) },
    select: { audioUrl: true },
  });
  if (!r?.audioUrl) return NextResponse.json({ erro: "Áudio não encontrado" }, { status: 404 });
  return respostaAudio(r.audioUrl, `observacao-${id}`);
}
