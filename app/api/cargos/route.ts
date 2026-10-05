import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const cargoSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  descricao: z.string().optional(),
  ativo: z.boolean().default(true),
});

// Leitura liberada a qualquer usuário logado: o formulário de colaborador lista os cargos.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const cargos = await prisma.cargo.findMany({
    where: { empresaId },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(cargos);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = cargoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const cargo = await prisma.cargo.create({ data: { ...parsed.data, empresaId } });
  return NextResponse.json(cargo, { status: 201 });
}
