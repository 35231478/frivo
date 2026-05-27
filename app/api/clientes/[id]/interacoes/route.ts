import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { interacaoClienteSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const interacoes = await prisma.interacaoCliente.findMany({
    where: { clienteId: id, empresaId },
    include: { usuario: { select: { id: true, nome: true } } },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(interacoes);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = interacaoClienteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const interacao = await prisma.interacaoCliente.create({
    data: { ...parsed.data, empresaId, clienteId: id, usuarioId },
    include: { usuario: { select: { id: true, nome: true } } },
  });

  return NextResponse.json(interacao, { status: 201 });
}
