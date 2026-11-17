import { type NextRequest } from "next/server";
import { podeVisualizarInline } from "@/lib/anexos";
import { respostaArquivo } from "@/lib/pdf/resposta";
import { arquivoDaDocumentacao } from "@/lib/documentacao/pacote-server";
import { origemDa, responderLink } from "@/lib/documentacao/pacote-rotas";

type Params = { params: Promise<{ token: string; itemId: string }> };

/**
 * UM arquivo do pacote. O id é o do ITEM do envio, não o do documento: trocar o id na URL não
 * alcança arquivo de outro pacote, de outro colaborador ou de outro tipo. `?ver=1` abre na aba.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { token, itemId } = await params;
  return responderLink(req, async () => {
    const a = await arquivoDaDocumentacao(token, itemId, origemDa(req));
    // Só o que a casa já considera seguro de abrir na aba (PDF e imagem); o resto baixa
    const inline = req.nextUrl.searchParams.get("ver") === "1" && podeVisualizarInline(a.tipo);
    return respostaArquivo(a, a.tipo, inline);
  });
}
