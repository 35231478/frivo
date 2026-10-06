import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { checklistTemplateSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["configuracoes", "visualizar"], ["veiculos", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const template = await prisma.checklistTemplate.findFirst({
    where: { id, empresaId },
    include: { itens: { orderBy: { ordem: "asc" } } },
  });
  if (!template) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(template);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["configuracoes", "gerenciar"], ["veiculos", "gerenciar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.checklistTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = checklistTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { itens, ...rest } = parsed.data;
  const template = await prisma.checklistTemplate.update({
    where: { id },
    data: {
      ...rest,
      itens: {
        deleteMany: {},
        create: itens.map((it, idx) => ({ ...it, ordem: it.ordem || idx })),
      },
    },
    include: { itens: { orderBy: { ordem: "asc" } } },
  });

  return NextResponse.json(template);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["configuracoes", "gerenciar"], ["veiculos", "gerenciar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.checklistTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.checklistTemplate.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
