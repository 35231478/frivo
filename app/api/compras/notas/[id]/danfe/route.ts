import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { visualizacaoDaNota } from "@/lib/compras/notas";
import { gerarDanfePdf } from "@/lib/compras/danfe-pdf";
import { nomeArquivoNota } from "@/lib/compras/danfe-texto";
import { dataHoraMarca } from "@/lib/fuso";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/compras/notas/:id/danfe — o PDF da DANFE simplificada, gerado do XML importado (Baixar PDF).
 * Nota sem XML legível: 404 (a gaveta nem mostra o botão). Estoque › visualizar; empresa da sessão.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "visualizar");
  if (guard.erro) return guard.resposta;
  const v = await visualizacaoDaNota(guard.session.user!.empresaId, (await params).id);
  if (!v) return NextResponse.json({ erro: "Nota não encontrada" }, { status: 404 });
  if (!v.danfe) return NextResponse.json({ erro: "Esta nota não tem o XML da NF-e: não há DANFE para gerar." }, { status: 404 });
  const bytes = await gerarDanfePdf(v.danfe, dataHoraMarca());
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeArquivoNota(v.nota.chave, "pdf")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
