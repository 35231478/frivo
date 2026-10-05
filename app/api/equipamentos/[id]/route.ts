import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { equipamentoSchema } from "@/lib/validations";
import { resolverTipoEquipamentoId } from "@/lib/tipo-equipamento";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const eq = await prisma.equipamento.findFirst({
    where: { id, empresaId },
    include: {
      unidade: {
        include: { cliente: { select: { id: true, nome: true, nomeFantasia: true } } },
      },
    },
  });
  if (!eq) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(eq);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipamentos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.equipamento.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = equipamentoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const unidade = await prisma.unidade.findFirst({ where: { id: parsed.data.unidadeId, empresaId } });
  if (!unidade) return NextResponse.json({ erro: "Unidade não encontrada" }, { status: 404 });

  const { dataInstalacao, dataFabricacao, garantiaInicio, garantiaAte, ...resto } = parsed.data;
  if (garantiaInicio && garantiaAte && garantiaInicio > garantiaAte)
    return NextResponse.json({ erro: "O início da garantia deve ser anterior ao fim." }, { status: 400 });
  const tipoEquipamentoId = await resolverTipoEquipamentoId(empresaId, resto.tipo);
  const atualizado = await prisma.equipamento.update({
    where: { id },
    data: {
      ...resto,
      tipoEquipamentoId,
      dataInstalacao: dataInstalacao ? new Date(dataInstalacao) : null,
      dataFabricacao: dataFabricacao ? new Date(dataFabricacao) : null,
      garantiaInicio: garantiaInicio ? new Date(garantiaInicio) : null,
      garantiaAte: garantiaAte ? new Date(garantiaAte) : null,
    },
  });
  return NextResponse.json(atualizado);
}

// Reativa/inativa sem mexer no cadastro. Inativar exige "excluir" (mesma regra do DELETE).
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipamentos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.equipamento.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.ativo !== "boolean") {
    return NextResponse.json({ erro: "Campo 'ativo' (boolean) é obrigatório." }, { status: 400 });
  }
  if (body.ativo === false && !pode(session.user!.permissoes, "equipamentos", "excluir", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });

  const atualizado = await prisma.equipamento.update({ where: { id }, data: { ativo: body.ativo } });
  return NextResponse.json({ ok: true, ativo: atualizado.ativo });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipamentos", "excluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.equipamento.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.equipamento.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
