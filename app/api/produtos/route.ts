import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  nome: z.string().min(1),
  descricao: z.string().optional(),
  unidade: z.string().default("un"),
  valorPadrao: z.number().optional().nullable(),
  estoqueMinimo: z.number().int().optional().nullable(),
  ativo: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const produtos = await prisma.produto.findMany({
    where: { empresaId: session.user!.empresaId },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(produtos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const item = await prisma.produto.create({
    data: { ...parsed.data, valorPadrao: parsed.data.valorPadrao ?? null, estoqueMinimo: parsed.data.estoqueMinimo ?? null, empresaId: session.user!.empresaId },
  });
  return NextResponse.json(item, { status: 201 });
}
