import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  nome: z.string().min(1).optional(),
  cor: z.string().optional(),
  ativo: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const existente = await prisma.categoriaFinanceira.findFirst({ where: { id, empresaId: guard.session.user.empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const cat = await prisma.categoriaFinanceira.update({ where: { id }, data: parsed.data });
  return NextResponse.json(cat);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const existente = await prisma.categoriaFinanceira.findFirst({ where: { id, empresaId: guard.session.user.empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
  await prisma.categoriaFinanceira.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
