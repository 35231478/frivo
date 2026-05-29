import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { prazoTemplateSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const template = await prisma.prazoTemplate.findFirst({
    where: { id, empresaId },
    include: { etapas: { orderBy: { ordem: "asc" } } },
  });
  if (!template) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(template);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.prazoTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  // Permite alternar somente o "ativo" (reativar/desativar)
  if (typeof body.ativo === "boolean" && Object.keys(body).length === 1) {
    const upd = await prisma.prazoTemplate.update({ where: { id }, data: { ativo: body.ativo } });
    return NextResponse.json(upd);
  }

  const parsed = prazoTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const atualizado = await prisma.prazoTemplate.update({
    where: { id },
    data: {
      nome: data.nome,
      descricao: data.descricao ?? null,
      cor: data.cor,
      ativo: data.ativo,
      etapas: {
        deleteMany: {},
        create: data.etapas.map((e, idx) => ({
          nome: e.nome,
          prazoHoras: e.prazoHoras,
          responsavel: e.responsavel,
          canal: e.canal,
          mensagem: e.mensagem ?? null,
          ordem: idx,
        })),
      },
    },
    include: { etapas: { orderBy: { ordem: "asc" } } },
  });

  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.prazoTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.prazoTemplate.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
