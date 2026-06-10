import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";

const schema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  cor: z.string().default("#64748B"),
  ativo: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const categorias = await prisma.categoriaFinanceira.findMany({
    where: { empresaId: session.user!.empresaId },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(categorias);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const cat = await prisma.categoriaFinanceira.create({ data: { ...parsed.data, empresaId: guard.session.user.empresaId } });
  return NextResponse.json(cat, { status: 201 });
}
