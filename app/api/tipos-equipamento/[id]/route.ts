import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { tipoEquipamentoSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

// Só os campos editáveis do cadastro, e sempre dentro da empresa do usuário.
const atualizarSchema = tipoEquipamentoSchema.partial();

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.tipoEquipamentoCustom.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const parsed = atualizarSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const item = await prisma.tipoEquipamentoCustom.update({ where: { id }, data: parsed.data });
  return NextResponse.json(item);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.tipoEquipamentoCustom.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.tipoEquipamentoCustom.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
