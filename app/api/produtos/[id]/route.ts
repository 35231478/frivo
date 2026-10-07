import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { primeiroErro, produtoEditarSchema } from "@/lib/produto-schema";

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

  // Edição parcial: só o que veio no corpo muda (Reativar manda só { ativo: true })
  const parsed = produtoEditarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: primeiroErro(parsed.error) }, { status: 400 });
  const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));

  const item = await prisma.produto.update({ where: { id }, data });
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
