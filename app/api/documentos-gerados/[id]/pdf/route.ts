import { NextResponse, type NextRequest } from "next/server";
import { respostaPdfArquivo } from "@/lib/pdf/resposta";
import { guardaDeDocumentos } from "@/lib/documentos/documentos-rotas";
import { ErroDocumento, pdfDoDocumento } from "@/lib/documentos/documentos-server";

type Params = { params: Promise<{ id: string }> };

/**
 * O PDF do documento: a prévia marcada como prévia enquanto não está assinado, o papel final
 * depois. `?ver=1` abre no navegador; sem isso, baixa. Documento de outra empresa é 404 — e papel
 * disciplinar também é 404 para quem não tem a permissão, porque quem não pode ver não precisa
 * nem saber que ele existe.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDeDocumentos();
  if (!ator) return resposta;
  const { id } = await params;
  try {
    const pdf = await pdfDoDocumento(id, ator.empresaId, ator.podeDisciplinar);
    return respostaPdfArquivo(pdf, req.nextUrl.searchParams.get("ver") === "1");
  } catch (e) {
    if (e instanceof ErroDocumento) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
