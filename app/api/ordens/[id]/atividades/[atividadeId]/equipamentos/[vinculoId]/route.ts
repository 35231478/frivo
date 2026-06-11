import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string; atividadeId: string; vinculoId: string }> };

// Confirma que o vínculo pertence à atividade/OS/empresa da sessão
async function getVinculo(empresaId: string, id: string, atividadeId: string, vinculoId: string) {
  return prisma.atividadeEquipamento.findFirst({
    where: { id: vinculoId, atividadeId, atividade: { ordemServicoId: id, empresaId } },
    select: { id: true, feito: true },
  });
}

const patchSchema = z.object({ feito: z.boolean() });

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, atividadeId, vinculoId } = await params;

  const vinculo = await getVinculo(session.user!.empresaId, id, atividadeId, vinculoId);
  if (!vinculo) return NextResponse.json({ erro: "Equipamento não encontrado na atividade" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const atualizado = await prisma.atividadeEquipamento.update({
    where: { id: vinculoId },
    data: {
      feito: parsed.data.feito,
      feitoEm: parsed.data.feito ? new Date() : null,
    },
    select: { id: true, feito: true, feitoEm: true },
  });
  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, atividadeId, vinculoId } = await params;

  if (!(await getVinculo(session.user!.empresaId, id, atividadeId, vinculoId))) {
    return NextResponse.json({ erro: "Equipamento não encontrado na atividade" }, { status: 404 });
  }

  await prisma.atividadeEquipamento.delete({ where: { id: vinculoId } });
  return NextResponse.json({ ok: true });
}
