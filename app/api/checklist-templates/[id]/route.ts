import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { checklistTemplateEditarSchema } from "@/lib/validations";
import { mesmoConteudo, planejarFilhos } from "@/lib/sincronizar-filhos";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["configuracoes", "visualizar"], ["veiculos", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const template = await prisma.checklistTemplate.findFirst({
    where: { id, empresaId },
    include: { itens: { where: { ativo: true }, orderBy: { ordem: "asc" } } },
  });
  if (!template) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(template);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["configuracoes", "gerenciar"], ["veiculos", "gerenciar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.checklistTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  // Edição parcial: só muda o que veio no corpo
  const parsed = checklistTemplateEditarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const { itens, ...rest } = parsed.data;

  // Itens: atualiza os existentes, cria os novos e INATIVA os removidos (nunca apaga — checklists
  // já preenchidos apontam para eles e o histórico do veículo tem que continuar inteiro).
  // Item JÁ usado em checklist preenchido cujo texto/tipo/opções mudou ganha nova versão.
  const plano = itens
    ? planejarFilhos(
      await prisma.checklistItemTemplate.findMany({
        where: { templateId: id },
        select: { id: true, ativo: true, categoria: true, descricao: true, tipo: true, opcoes: true, _count: { select: { itensPreenchidos: true } } },
      }),
      itens.map((it, idx) => ({ ...it, ordem: it.ordem || idx })),
      {
        versionar: (e, it) => e._count.itensPreenchidos > 0
          && (e.categoria !== it.categoria || e.descricao !== it.descricao || e.tipo !== it.tipo || !mesmoConteudo(e.opcoes, it.opcoes)),
      },
    )
    : null;
  if (plano?.invalidos.length) return NextResponse.json({ erro: "Item inválido (não pertence a este checklist)." }, { status: 400 });

  const template = await prisma.$transaction(async (tx) => {
    if (plano) {
      if (plano.inativar.length) await tx.checklistItemTemplate.updateMany({ where: { id: { in: plano.inativar }, templateId: id }, data: { ativo: false } });
      for (const { id: itemId, ...it } of plano.atualizar) await tx.checklistItemTemplate.update({ where: { id: itemId }, data: { ...it, ativo: true } });
      for (const it of plano.criar) await tx.checklistItemTemplate.create({ data: { ...it, templateId: id, ativo: true } });
    }
    return tx.checklistTemplate.update({
      where: { id },
      data: Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
      include: { itens: { where: { ativo: true }, orderBy: { ordem: "asc" } } },
    });
  });

  return NextResponse.json(template);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["configuracoes", "gerenciar"], ["veiculos", "gerenciar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.checklistTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.checklistTemplate.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
