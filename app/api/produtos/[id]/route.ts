import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  // Garante isolamento de tenant antes de alterar
  const existente = await prisma.produto.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const { id: _i, empresaId: _e, criadoEm: _c, valorPadrao, estoqueMinimo, ...resto } = body;

  const item = await prisma.produto.update({
    where: { id },
    data: { ...resto, valorPadrao: valorPadrao ?? null, estoqueMinimo: estoqueMinimo ?? null },
  });
  return NextResponse.json(item);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.produto.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.produto.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
