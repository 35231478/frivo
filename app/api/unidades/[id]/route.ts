import { NextRequest, NextResponse } from "next/server";
import { erroDeValidacao } from "@/lib/forms/erros-server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { dadosParciais, unidadeContextoSchema, unidadeSchema } from "@/lib/validations";
import { impactoEndereco } from "@/lib/inativacao-server";

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
    return erroDeValidacao(parsed.error);
  }

  // Não permite reatribuir a unidade a outro cliente nesta rota (evita mover entre clientes/tenants)
  const { clienteId: _clienteId, ...dadosAtualizacao } = parsed.data;
  const atualizado = await prisma.unidade.update({ where: { id }, data: dadosAtualizacao });
  return NextResponse.json(atualizado);
}

/**
 * PATCH: edição no contexto (de dentro da OS e do orçamento) — nome e endereço, e só o que mudou.
 * Mesma permissão da edição completa; o cliente, a marcação de principal e o resto não são tocados.
 * Com { ativo: true }: reativa o endereço inativado (o botão padrão dos cadastros).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("clientes", "editar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user!.empresaId;

  const existente = await prisma.unidade.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  // Reativar (botão padrão dos cadastros): { ativo: true } — o endereço volta às listas e seletores
  if (body?.ativo === true) {
    const reativado = await prisma.unidade.update({ where: { id }, data: { ativo: true } });
    return NextResponse.json(reativado);
  }
  const parsed = unidadeContextoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const dados = dadosParciais(parsed.data);
  if (!Object.keys(dados).length) return NextResponse.json({ erro: "Nada para alterar." }, { status: 400 });
  const atualizado = await prisma.unidade.update({ where: { id }, data: dados });
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

  // A mesma regra do modal (GET …/impacto): principal e equipamentos ativos bloqueiam; o resto só avisa
  const impacto = await impactoEndereco(id, empresaId);
  if (impacto?.bloqueio) return NextResponse.json({ erro: impacto.bloqueio }, { status: 409 });

  await prisma.unidade.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
