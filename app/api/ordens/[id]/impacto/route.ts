import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { motivoBloqueioInativacao } from "@/lib/os-server";

/**
 * Pré-checagem do modal de inativar OS (o botão padrão dos cadastros): a OS já em medição não é
 * inativada — a mesma regra do DELETE e da ação em massa, mostrada ANTES de confirmar. Ordens › Excluir.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("ordens", "excluir");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId: guard.session.user!.empresaId }, select: { id: true } });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json({ bloqueio: await motivoBloqueioInativacao(id), avisos: [] });
}
