import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { gerarDocumento, respostaPdf } from "@/lib/pmoc-documento-server";

/**
 * O documento do plano em PDF, gerado na hora a partir do cadastro (?inline=1 abre no navegador).
 * Quem vê o PMOC baixa o documento — inclusive o de um rascunho, para conferir antes de publicar.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("pmoc", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const pdf = await gerarDocumento({ id, empresaId: guard.session.user!.empresaId });
  if (!pdf) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  return respostaPdf(pdf, req.nextUrl.searchParams.get("inline") === "1");
}
