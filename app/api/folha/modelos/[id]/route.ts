import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { modeloEncargosSchema } from "@/lib/folha/validacao";

type Params = { params: Promise<{ id: string }> };

/** Editar modelo de encargos (nome, regime, padrão e percentuais). Só "Financeiro › Custo de pessoal". */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "folha");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.modeloEncargos.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Modelo não encontrado" }, { status: 404 });

  const parsed = modeloEncargosSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const d = parsed.data;
  if (d.nome !== existente.nome && await prisma.modeloEncargos.findFirst({ where: { empresaId, nome: d.nome, id: { not: id } }, select: { id: true } }))
    return NextResponse.json({ erro: "Já existe um modelo com esse nome" }, { status: 409 });
  if (d.regime !== existente.regime && await prisma.colaboradorFolha.count({ where: { empresaId, modeloEncargosId: id } }))
    return NextResponse.json({ erro: "Há colaboradores usando este modelo: não dá para mudar o tipo de contrato dele" }, { status: 409 });

  const atualizado = await prisma.$transaction(async (tx) => {
    if (d.padrao) await tx.modeloEncargos.updateMany({ where: { empresaId, regime: d.regime, id: { not: id } }, data: { padrao: false } });
    return tx.modeloEncargos.update({ where: { id }, data: { nome: d.nome, regime: d.regime, padrao: d.padrao, itens: d.itens } });
  });
  return NextResponse.json(atualizado);
}

/** Excluir: quem usava o modelo volta para o padrão do regime (FK com SET NULL). */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "folha");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const existente = await prisma.modeloEncargos.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Modelo não encontrado" }, { status: 404 });
  await prisma.modeloEncargos.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
