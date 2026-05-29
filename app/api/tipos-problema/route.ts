import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  nome: z.string().min(1),
  ativo: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const tipos = await prisma.tipoProblema.findMany({
    where: { empresaId: session.user!.empresaId },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(tipos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const item = await prisma.tipoProblema.create({
    data: { nome: parsed.data.nome, empresaId: session.user!.empresaId },
  });
  return NextResponse.json(item, { status: 201 });
}
