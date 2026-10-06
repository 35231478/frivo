import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { unidadeSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["clientes", "visualizar"], ["ordens", "visualizar"], ["equipamentos", "visualizar"], ["contratos", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const unidade = await prisma.unidade.findFirst({
    where: { id, empresaId },
    include: { _count: { select: { equipamentos: true } } },
  });
  if (!unidade) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(unidade);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("clientes", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.unidade.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();

  // Se é uma operação de marcar como principal
  if (body._marcarPrincipal) {
    await prisma.$transaction([
      prisma.unidade.updateMany({
        where: { clienteId: existente.clienteId, empresaId, principal: true },
        data: { principal: false },
      }),
      prisma.unidade.update({ where: { id }, data: { principal: true } }),
    ]);
    const atualizado = await prisma.unidade.findUnique({ where: { id } });
    return NextResponse.json(atualizado);
  }

  const parsed = unidadeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  // Não permite reatribuir a unidade a outro cliente nesta rota (evita mover entre clientes/tenants)
  const { clienteId: _clienteId, ...dadosAtualizacao } = parsed.data;
  const atualizado = await prisma.unidade.update({ where: { id }, data: dadosAtualizacao });
  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("clientes", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.unidade.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  if (existente.principal) {
    return NextResponse.json({ erro: "Não é possível remover o endereço principal." }, { status: 409 });
  }

  const equipamentos = await prisma.equipamento.count({ where: { unidadeId: id, ativo: true } });
  if (equipamentos > 0) {
    return NextResponse.json(
      { erro: `Não é possível remover: existem ${equipamentos} equipamento(s) vinculado(s) a este endereço.` },
      { status: 409 }
    );
  }

  await prisma.unidade.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
