import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { listarDespesas, soEscritorio } from "@/lib/execucao/despesas";
import { prisma } from "@/lib/prisma";
import { escopoBarra } from "@/lib/escopo/proprios-server";

type Params = { params: Promise<{ id: string }> };

/** As despesas de campo desta OS (o custo que fica na OS), para quem vê o Financeiro. */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const fora = soEscritorio(guard.session);
  if (fora) return fora;
  const { id } = await params;
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const empresaId = guard.session.user.empresaId;
  if (!(await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true } }))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json({ despesas: await listarDespesas(empresaId, { status: "TODAS", osId: id }) }, { headers: { "Cache-Control": "private, no-store" } });
}
