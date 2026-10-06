import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string; anexoId: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("contratos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoContrato.findFirst({ where: { id: anexoId, contratoId: id, empresaId } });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  return NextResponse.json(anexo);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("contratos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoContrato.findFirst({ where: { id: anexoId, contratoId: id, empresaId } });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  await prisma.anexoContrato.delete({ where: { id: anexoId } });
  return NextResponse.json({ ok: true });
}
