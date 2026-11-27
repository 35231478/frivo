import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { listarDespesas } from "@/lib/execucao/despesas";

type Params = { params: Promise<{ id: string }> };

/** As despesas de campo desta OS (o custo que fica na OS), para quem vê o Financeiro. */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;
  if (!(await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true } }))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json({ despesas: await listarDespesas(empresaId, { status: "TODAS", osId: id }) }, { headers: { "Cache-Control": "private, no-store" } });
}
