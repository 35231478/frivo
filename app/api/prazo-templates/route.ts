import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { prazoTemplateSchema } from "@/lib/validations";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const templates = await prisma.prazoTemplate.findMany({
    where: { empresaId: session.user!.empresaId },
    include: { etapas: { orderBy: { ordem: "asc" } }, _count: { select: { osPrazos: true } } },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const parsed = prazoTemplateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const template = await prisma.prazoTemplate.create({
    data: {
      empresaId,
      nome: data.nome,
      descricao: data.descricao ?? null,
      cor: data.cor,
      ativo: data.ativo,
      etapas: {
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

  return NextResponse.json(template, { status: 201 });
}
