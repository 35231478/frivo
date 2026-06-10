import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

const perfilUpdateSchema = z.object({
  nome: z.string().min(1).optional(),
  descricao: z.string().optional(),
  tipo: z.enum(["ADMINISTRADOR", "SUPERVISOR", "FINANCEIRO", "TECNICO", "AUXILIAR", "PERSONALIZADO"]).optional(),
  cor: z.string().optional(),
  ativo: z.boolean().optional(),
  permissoes: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
});

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;

  const perfil = await prisma.perfilAcesso.findFirst({ where: { id, empresaId: guard.session.user.empresaId } });
  if (!perfil) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(perfil);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const existente = await prisma.perfilAcesso.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = perfilUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const perfil = await prisma.perfilAcesso.update({ where: { id }, data: parsed.data });
  return NextResponse.json(perfil);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const perfil = await prisma.perfilAcesso.findFirst({
    where: { id, empresaId },
    include: { _count: { select: { usuarios: true, colaboradores: true } } },
  });
  if (!perfil) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  if (perfil.padraoSistema) {
    return NextResponse.json({ erro: "Perfis padrão do sistema não podem ser excluídos." }, { status: 400 });
  }
  const vinculos = perfil._count.usuarios + perfil._count.colaboradores;
  if (vinculos > 0) {
    return NextResponse.json({ erro: `Não é possível excluir: ${vinculos} colaborador(es)/usuário(s) vinculado(s).` }, { status: 400 });
  }

  await prisma.perfilAcesso.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
