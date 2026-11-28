import { NextRequest, NextResponse } from "next/server";
import { comEscopo, filtroOrdens } from "@/lib/escopo/proprios";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  // COM-1: "Ver só os próprios" — prazo de OS fora do escopo é "não encontrado"
  const prazo = await prisma.osPrazo.findFirst({ where: { id, ordemServico: comEscopo({ empresaId }, filtroOrdens(session.user)) } });
  if (!prazo) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.osPrazo.update({ where: { id }, data: { status: "CANCELADO" } });
  return NextResponse.json({ ok: true });
}
