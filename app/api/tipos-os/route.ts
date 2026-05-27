import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const tipoOsSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  descricao: z.string().optional(),
  cor: z.string().default("#3b82f6"),
  ativo: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const tipos = await prisma.tipoOs.findMany({
    where: { empresaId },
    include: { formularios: { where: { ativo: true }, select: { id: true, nome: true } } },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(tipos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = tipoOsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const tipo = await prisma.tipoOs.create({ data: { ...parsed.data, empresaId } });
  return NextResponse.json(tipo, { status: 201 });
}
