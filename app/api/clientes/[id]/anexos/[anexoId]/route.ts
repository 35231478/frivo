import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; anexoId: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "visualizar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoCliente.findFirst({
    where: { id: anexoId, clienteId: id, empresaId },
  });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  return NextResponse.json(anexo);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoCliente.findFirst({
    where: { id: anexoId, clienteId: id, empresaId },
  });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  await prisma.anexoCliente.delete({ where: { id: anexoId } });
  return NextResponse.json({ ok: true });
}
