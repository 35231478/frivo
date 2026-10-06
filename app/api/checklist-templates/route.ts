import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { checklistTemplateSchema } from "@/lib/validations";

export async function GET() {
  const guard = await exigirAlgumaPermissao([["configuracoes", "visualizar"], ["veiculos", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const templates = await prisma.checklistTemplate.findMany({
    where: { empresaId },
    include: { itens: { orderBy: { ordem: "asc" } }, _count: { select: { itens: true, preenchidos: true } } },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["configuracoes", "gerenciar"], ["veiculos", "gerenciar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = checklistTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { itens, ...rest } = parsed.data;
  const template = await prisma.checklistTemplate.create({
    data: {
      ...rest,
      empresaId,
      itens: { create: itens.map((it, idx) => ({ ...it, ordem: it.ordem || idx })) },
    },
    include: { itens: { orderBy: { ordem: "asc" } } },
  });

  return NextResponse.json(template, { status: 201 });
}
