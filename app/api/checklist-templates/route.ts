import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checklistTemplateSchema } from "@/lib/validations";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const templates = await prisma.checklistTemplate.findMany({
    where: { empresaId },
    include: { itens: { orderBy: { ordem: "asc" } }, _count: { select: { itens: true, preenchidos: true } } },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = checklistTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { itens, ...rest } = parsed.data;
  const template = await prisma.checklistTemplate.create({
    data: {
      ...rest,
      empresaId,
      itens: { create: itens.map((it, idx) => ({ ...it, ordem: it.ordem || idx })) },
    },
    include: { itens: { orderBy: { ordem: "asc" } } },
  });

  return NextResponse.json(template, { status: 201 });
}
