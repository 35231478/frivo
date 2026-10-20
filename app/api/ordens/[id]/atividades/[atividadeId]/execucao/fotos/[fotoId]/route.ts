import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoExecucao } from "@/lib/execucao/contexto";

type Params = { params: Promise<{ id: string; atividadeId: string; fotoId: string }> };

/** Tira UMA foto (a que a pessoa escolheu), com a atividade aberta. Nada mais é apagado. */
export async function DELETE(_: NextRequest, { params }: Params) {
  const { id, atividadeId, fotoId } = await params;
  const ctx = await contextoExecucao(id, atividadeId);
  if (!ctx.ok) return ctx.resposta;
  const { count } = await prisma.fotoAtendimento.deleteMany({ where: { id: fotoId, atividadeId, empresaId: ctx.empresaId } });
  if (!count) return NextResponse.json({ erro: "Foto não encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
