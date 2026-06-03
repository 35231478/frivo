import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { termoTemplateSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.termoReferenciaTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Termo não encontrado" }, { status: 404 });

  const parsed = termoTemplateSchema.partial().safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const data: any = {};
  if (parsed.data.nome !== undefined) data.nome = parsed.data.nome;
  if (parsed.data.descricao !== undefined) data.descricao = parsed.data.descricao || null;
  if (parsed.data.conteudo !== undefined) data.conteudo = parsed.data.conteudo || "";
  if (parsed.data.ativo !== undefined) data.ativo = parsed.data.ativo;

  const termo = await prisma.termoReferenciaTemplate.update({ where: { id }, data });
  return NextResponse.json(termo);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.termoReferenciaTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Termo não encontrado" }, { status: 404 });

  await prisma.termoReferenciaTemplate.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
