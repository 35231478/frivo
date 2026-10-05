import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { tipoEquipamentoSchema } from "@/lib/validations";

// Leitura liberada a qualquer usuário logado (formulário de equipamento lista os tipos).
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const tipos = await prisma.tipoEquipamentoCustom.findMany({
    where: { empresaId: session.user!.empresaId },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(tipos);
}

// Tipos de equipamento são cadastro de configuração.
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  const parsed = tipoEquipamentoSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const duplicado = await prisma.tipoEquipamentoCustom.findFirst({
    where: { empresaId, ativo: true, nome: { equals: parsed.data.nome, mode: "insensitive" } },
    select: { id: true },
  });
  if (duplicado) return NextResponse.json({ erro: "Já existe um tipo de equipamento com esse nome." }, { status: 409 });

  const item = await prisma.tipoEquipamentoCustom.create({
    data: { ...parsed.data, descricao: parsed.data.descricao || null, empresaId },
  });
  return NextResponse.json(item, { status: 201 });
}
