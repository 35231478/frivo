import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contatoClienteSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const contatos = await prisma.contatoCliente.findMany({
    where: { clienteId: id, empresaId, ativo: true },
    orderBy: [{ principal: "desc" }, { nome: "asc" }],
  });

  return NextResponse.json(contatos);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = contatoClienteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const contato = await prisma.contatoCliente.create({
    data: { ...parsed.data, empresaId, clienteId: id },
  });

  return NextResponse.json(contato, { status: 201 });
}
