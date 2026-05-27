import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const itemSchema = z.object({
  descricao: z.string().min(1),
  quantidade: z.number().positive(),
  valorUnitario: z.number().positive(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const valorTotal = parsed.data.quantidade * parsed.data.valorUnitario;
  const item = await prisma.osItemOrcamento.create({
    data: { ordemServicoId: id, ...parsed.data, valorTotal },
  });

  await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Item de orçamento adicionado", detalhes: parsed.data.descricao },
  });

  return NextResponse.json(item, { status: 201 });
}
