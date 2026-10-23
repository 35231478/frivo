import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

/**
 * UX-8 (Y6): habilita UMA competência (tipo de OS) num colaborador existente, sem sair da Nova OS.
 * É ADITIVO: não mexe nas demais competências (o PUT do colaborador substitui a lista toda).
 * Mesma permissão de editar colaborador.
 */
const schema = z.object({ tipoOsId: z.string().min(1) }).strict();

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = (guard.session.user as any).empresaId as string;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const { tipoOsId } = parsed.data;

  const [tecnico, tipo] = await Promise.all([
    prisma.tecnico.findFirst({ where: { id, empresaId, ativo: true }, select: { id: true } }),
    prisma.tipoOs.findFirst({ where: { id: tipoOsId, empresaId }, select: { id: true } }),
  ]);
  if (!tecnico) return NextResponse.json({ erro: "Colaborador não encontrado" }, { status: 404 });
  if (!tipo) return NextResponse.json({ erro: "Tipo de OS não encontrado" }, { status: 404 });

  await prisma.tecnico.update({ where: { id }, data: { competencias: { connect: { id: tipoOsId } } } });
  return NextResponse.json({ ok: true });
}
