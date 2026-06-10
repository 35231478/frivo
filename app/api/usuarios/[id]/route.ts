import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  perfilAcessoId: z.string().nullable().optional(),
});

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const usuario = await prisma.usuario.findFirst({ where: { id, empresaId } });
  if (!usuario) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const atualizado = await prisma.usuario.update({
    where: { id },
    data: { perfilAcessoId: parsed.data.perfilAcessoId || null },
    select: { id: true, nome: true, email: true, role: true, perfilAcessoId: true, perfilAcesso: { select: { nome: true, cor: true } } },
  });
  return NextResponse.json(atualizado);
}
