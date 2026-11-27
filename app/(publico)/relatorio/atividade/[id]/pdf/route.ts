import { NextRequest, NextResponse } from "next/server";
import { carregarAtividade } from "@/lib/relatorio-server";
import { gerarRelatorioAtividadePdf } from "@/lib/relatorio-atividade-pdf";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * O relatório da atividade em PDF: /relatorio/atividade/<id>/pdf?t=<token>. O mesmo segredo da página: sem o token
 * certo, a mesma 404 do id inexistente. Abre no navegador (inline) e baixa com o nome do relatório.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const dados = await carregarAtividade(id, req.nextUrl.searchParams.get("t"));
  if (!dados) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  const { bytes, nomeArquivo } = await gerarRelatorioAtividadePdf({
    empresa: dados.empresa, os: dados.os, atividade: dados.atividade, equipamentos: dados.equipamentos, adicionais: dados.adicionais,
    fotosServico: dados.fotosServico, materiais: dados.materiais, aceite: dados.aceite, numero: dados.numero, geradoEm: new Date(),
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="relatorio.pdf"; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
