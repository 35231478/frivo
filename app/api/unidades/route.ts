import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { unidadeSchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["clientes", "visualizar"], ["ordens", "visualizar"], ["equipamentos", "visualizar"], ["contratos", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;

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
  const guard = await exigirPermissao("clientes", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

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
