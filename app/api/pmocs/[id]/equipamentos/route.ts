import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { SELECT_PMOC } from "@/lib/pmoc-server";

type Params = { params: Promise<{ id: string }> };

async function pmocEditavel(id: string, empresaId: string) {
  const p = await prisma.pmoc.findFirst({ where: { id, empresaId }, select: { id: true, ativo: true, clienteId: true, status: true } });
  if (!p) return { erro: NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 }) };
  if (!p.ativo) return { erro: NextResponse.json({ erro: "PMOC inativo: reative antes de editar." }, { status: 409 }) };
  return { p };
}

/** Adiciona equipamentos ao PMOC. Body: { equipamentoIds: string[] } — só do mesmo cliente. */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const { p, erro } = await pmocEditavel(id, empresaId);
  if (erro) return erro;

  const parsed = z.object({ equipamentoIds: z.array(z.string()).min(1).max(500) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: "Selecione ao menos um equipamento." }, { status: 400 });
  const ids = [...new Set(parsed.data.equipamentoIds)];
  const validos = await prisma.equipamento.findMany({
    where: { id: { in: ids }, empresaId, ativo: true, unidade: { clienteId: p!.clienteId } },
    select: { id: true },
  });
  if (validos.length !== ids.length)
    return NextResponse.json({ erro: "Há equipamento(s) inativos ou de outro cliente na seleção." }, { status: 400 });
  await prisma.pmocEquipamento.createMany({ data: ids.map((equipamentoId) => ({ pmocId: id, equipamentoId })), skipDuplicates: true });
  return NextResponse.json(await prisma.pmoc.findFirst({ where: { id }, select: SELECT_PMOC }));
}

/** Remove um equipamento do PMOC (?equipamentoId=). Não mexe no cadastro do equipamento. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const { p, erro } = await pmocEditavel(id, empresaId);
  if (erro) return erro;
  const equipamentoId = req.nextUrl.searchParams.get("equipamentoId") ?? "";
  const total = await prisma.pmocEquipamento.count({ where: { pmocId: id } });
  // PMOC publicado não pode ficar sem equipamento (mesma regra de publicação)
  if (p!.status === "PUBLICADO" && total <= 1)
    return NextResponse.json({ erro: "Um PMOC publicado precisa de pelo menos 1 equipamento. Volte para Rascunho antes de remover o último." }, { status: 409 });
  const r = await prisma.pmocEquipamento.deleteMany({ where: { pmocId: id, equipamentoId } });
  if (!r.count) return NextResponse.json({ erro: "Equipamento não está neste PMOC." }, { status: 404 });
  return NextResponse.json(await prisma.pmoc.findFirst({ where: { id }, select: SELECT_PMOC }));
}
