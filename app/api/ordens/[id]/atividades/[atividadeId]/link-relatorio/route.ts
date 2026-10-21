import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { linkRelatorioAtividade, novoTokenRelatorio } from "@/lib/relatorio-atividade-link";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

/** "Gerar novo link" do relatório da atividade: troca o token; o link antigo passa a dar 404. */
export async function POST(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { id, atividadeId } = await params;
  const empresaId = guard.session.user!.empresaId;

  const tokenRelatorio = novoTokenRelatorio();
  const { count } = await prisma.atividadeOs.updateMany({
    where: { id: atividadeId, ordemServicoId: id, empresaId },
    data: { tokenRelatorio },
  });
  if (count === 0) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json({ link: linkRelatorioAtividade({ id: atividadeId, tokenRelatorio }) });
}
