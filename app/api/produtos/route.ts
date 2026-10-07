import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { primeiroErro, produtoCriarSchema } from "@/lib/produto-schema";

export async function GET() {
  // Leitura de catálogo: qualquer usuário logado (usado nas telas de OS, orçamento, contrato e cliente).
  // Gravar exige configuracoes.gerenciar.
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const produtos = await prisma.produto.findMany({
    where: { empresaId: session.user!.empresaId },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(produtos);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

  const parsed = produtoCriarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: primeiroErro(parsed.error) }, { status: 400 });

  const item = await prisma.produto.create({
    data: { ...parsed.data, valorPadrao: parsed.data.valorPadrao ?? null, estoqueMinimo: parsed.data.estoqueMinimo ?? null, empresaId: session.user!.empresaId },
  });
  return NextResponse.json(item, { status: 201 });
}
