import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { unidadeSchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const clienteId = searchParams.get("clienteId");

  const unidades = await prisma.unidade.findMany({
    where: {
      empresaId,
      ativo: true,
      ...(clienteId && { clienteId }),
    },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(unidades);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;
  const body = await req.json();
  const parsed = unidadeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  // Garante que o cliente pertence à empresa
  const cliente = await prisma.cliente.findFirst({
    where: { id: parsed.data.clienteId, empresaId },
  });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const unidade = await prisma.unidade.create({
    data: { ...parsed.data, empresaId },
  });

  return NextResponse.json(unidade, { status: 201 });
}
